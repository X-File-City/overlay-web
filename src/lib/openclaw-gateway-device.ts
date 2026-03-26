import { execFile } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEVICE_CACHE_DIR = path.join(os.tmpdir(), 'overlay-openclaw-devices')
const KNOWN_HOSTS_PATH = path.join(os.tmpdir(), 'overlay-openclaw-known-hosts')
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const inMemoryIdentityCache = new Map<string, GatewayDeviceIdentity | null>()

export interface GatewayDeviceIdentity {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
  platform?: string
  deviceFamily?: string
  clientId?: string
  clientMode?: string
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '')
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der',
  })

  if (
    Buffer.isBuffer(spki) &&
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length)
  }

  return Buffer.from(spki)
}

function deriveDeviceId(publicKeyPem: string): string {
  return createHash('sha256').update(derivePublicKeyRaw(publicKeyPem)).digest('hex')
}

function isGatewayDeviceIdentity(value: unknown): value is GatewayDeviceIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.deviceId === 'string' &&
    typeof candidate.publicKeyPem === 'string' &&
    typeof candidate.privateKeyPem === 'string'
  )
}

function normalizeGatewayDeviceIdentity(identity: GatewayDeviceIdentity): GatewayDeviceIdentity {
  return {
    ...identity,
    deviceId: deriveDeviceId(identity.publicKeyPem),
  }
}

function hasGatewayDevicePairingMetadata(identity: GatewayDeviceIdentity | null): boolean {
  return Boolean(
    identity?.clientId?.trim() &&
    identity.clientMode?.trim() &&
    identity.platform?.trim()
  )
}

async function readCachedGatewayDeviceIdentity(
  computerId: string
): Promise<GatewayDeviceIdentity | null> {
  const filePath = path.join(DEVICE_CACHE_DIR, `${computerId}.json`)

  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isGatewayDeviceIdentity(parsed)) {
      return null
    }
    return normalizeGatewayDeviceIdentity(parsed)
  } catch {
    return null
  }
}

async function writeCachedGatewayDeviceIdentity(
  computerId: string,
  identity: GatewayDeviceIdentity
): Promise<void> {
  const filePath = path.join(DEVICE_CACHE_DIR, `${computerId}.json`)
  await fs.mkdir(DEVICE_CACHE_DIR, { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 })
}

async function fetchGatewayDeviceIdentityOverSsh(
  ip: string
): Promise<GatewayDeviceIdentity | null> {
  try {
    const { stdout } = await execFileAsync('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      `UserKnownHostsFile=${KNOWN_HOSTS_PATH}`,
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=5',
      `root@${ip}`,
      `python3 - <<'PY'
import json
import subprocess
from pathlib import Path

identity = json.loads(Path('/root/.openclaw/identity/device.json').read_text())
paired = None

try:
    devices = json.loads(
        subprocess.run(
            ['/usr/local/bin/openclaw', 'devices', 'list', '--json'],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    for candidate in devices.get('paired', []):
        if candidate.get('deviceId') == identity.get('deviceId'):
            paired = candidate
            break
except Exception:
    paired = None

if paired:
    identity['platform'] = paired.get('platform')
    identity['deviceFamily'] = paired.get('deviceFamily')
    identity['clientId'] = paired.get('clientId')
    identity['clientMode'] = paired.get('clientMode')

print(json.dumps(identity))
PY`,
    ])

    const parsed = JSON.parse(stdout) as unknown
    if (!isGatewayDeviceIdentity(parsed)) {
      return null
    }

    return normalizeGatewayDeviceIdentity(parsed)
  } catch {
    return null
  }
}

export async function resolveDevelopmentGatewayDeviceIdentity(params: {
  computerId: string
  ip: string
}): Promise<GatewayDeviceIdentity | null> {
  const shouldUseSshFallback =
    process.env.NODE_ENV === 'development' || process.env.OPENCLAW_ENABLE_SSH_DEVICE_FALLBACK === '1'

  if (!shouldUseSshFallback) {
    return null
  }

  const cacheKey = `${params.computerId}:${params.ip}`
  if (inMemoryIdentityCache.has(cacheKey)) {
    const cachedIdentity = inMemoryIdentityCache.get(cacheKey) ?? null
    if (hasGatewayDevicePairingMetadata(cachedIdentity)) {
      return cachedIdentity
    }
  }

  const cachedIdentity = await readCachedGatewayDeviceIdentity(params.computerId)
  if (hasGatewayDevicePairingMetadata(cachedIdentity)) {
    inMemoryIdentityCache.set(cacheKey, cachedIdentity)
    return cachedIdentity
  }

  const fetchedIdentity = await fetchGatewayDeviceIdentityOverSsh(params.ip)
  if (fetchedIdentity) {
    await writeCachedGatewayDeviceIdentity(params.computerId, fetchedIdentity).catch(() => {})
    inMemoryIdentityCache.set(cacheKey, fetchedIdentity)
    return fetchedIdentity
  }

  inMemoryIdentityCache.set(cacheKey, null)
  return null
}

export async function attachDevelopmentGatewayDeviceIdentity<
  T extends { hetznerServerIp: string; gatewayDeviceIdentity?: GatewayDeviceIdentity | undefined },
>(params: {
  computerId: string
  connection: T
}): Promise<T> {
  if (params.connection.gatewayDeviceIdentity) {
    return params.connection
  }

  const gatewayDeviceIdentity = await resolveDevelopmentGatewayDeviceIdentity({
    computerId: params.computerId,
    ip: params.connection.hetznerServerIp,
  })

  if (!gatewayDeviceIdentity) {
    return params.connection
  }

  return {
    ...params.connection,
    gatewayDeviceIdentity,
  }
}

export function buildGatewayDeviceAuthPayloadV3(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token?: string | null
  nonce: string
  platform: string
  deviceFamily?: string
}): string {
  const scopes = params.scopes.join(',')
  const token = params.token ?? ''
  const platform = params.platform.trim().toLowerCase()
  const deviceFamily = params.deviceFamily?.trim().toLowerCase() || ''

  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join('|')
}

export function buildGatewayConnectDevice(params: {
  identity: GatewayDeviceIdentity
  clientId?: string
  clientMode?: string
  role: string
  scopes: string[]
  signedAtMs: number
  token?: string | null
  nonce: string
  platform?: string
  deviceFamily?: string
}): {
  id: string
  publicKey: string
  signature: string
  signedAt: number
  nonce: string
} {
  const payload = buildGatewayDeviceAuthPayloadV3({
    deviceId: params.identity.deviceId,
    clientId: params.clientId ?? params.identity.clientId ?? 'cli',
    clientMode: params.clientMode ?? params.identity.clientMode ?? 'cli',
    role: params.role,
    scopes: params.scopes,
    signedAtMs: params.signedAtMs,
    token: params.token ?? null,
    nonce: params.nonce,
    platform: params.platform ?? params.identity.platform ?? '',
    deviceFamily: params.deviceFamily ?? params.identity.deviceFamily,
  })

  const signature = base64UrlEncode(
    cryptoSign(null, Buffer.from(payload, 'utf8'), createPrivateKey(params.identity.privateKeyPem))
  )

  return {
    id: params.identity.deviceId,
    publicKey: base64UrlEncode(derivePublicKeyRaw(params.identity.publicKeyPem)),
    signature,
    signedAt: params.signedAtMs,
    nonce: params.nonce,
  }
}
