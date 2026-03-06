'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'

interface NavbarProps {
  scrollYProgress: { get: () => number }
}

interface AuthState {
  authenticated: boolean
  user?: {
    id: string
    email: string
    firstName?: string
    lastName?: string
  }
}

export function Navbar({ scrollYProgress }: NavbarProps) {
  const [authState, setAuthState] = useState<AuthState>({ authenticated: false })
  const [isPastHero, setIsPastHero] = useState(false)

  // Check auth state on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/session')
        const data = await response.json()
        setAuthState(data)
      } catch {
        setAuthState({ authenticated: false })
      }
    }
    checkAuth()
  }, [])

  // Track scroll position to change navbar layout
  useEffect(() => {
    const checkPosition = () => {
      const progress = scrollYProgress.get()
      setIsPastHero(progress > 0.06)
    }
    
    // Check immediately
    checkPosition()
    
    // Set up interval to check
    const interval = setInterval(checkPosition, 50)
    
    return () => clearInterval(interval)
  }, [scrollYProgress])

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 py-6 px-8">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        {/* Logo - always visible, fades in when past hero */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isPastHero ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/assets/overlay-logo.png"
              alt="Overlay"
              width={28}
              height={28}
            />
            <span className="font-serif text-xl">overlay</span>
          </Link>
        </motion.div>

        {/* Navigation Links - always on the right */}
        <div className="flex items-center gap-6">
          <Link
            href="/manifesto"
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            manifesto
          </Link>
          <a
            href="https://x.com/dsllwn/status/2015923879668044002"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            demo
          </a>
          <Link
            href="/pricing"
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            pricing
          </Link>
          {authState.authenticated ? (
            <Link
              href="/account"
              className="text-sm px-4 py-2 bg-zinc-900 text-white rounded-lg font-medium hover:bg-zinc-800 transition-colors"
            >
              account
            </Link>
          ) : (
            <Link
              href="/auth/sign-in"
              className="text-sm px-4 py-2 bg-zinc-900 text-white rounded-lg font-medium hover:bg-zinc-800 transition-colors"
            >
              sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}

export function HeroLinks() {
  const [authState, setAuthState] = useState<AuthState>({ authenticated: false })

  // Check auth state on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/session')
        const data = await response.json()
        setAuthState(data)
      } catch {
        setAuthState({ authenticated: false })
      }
    }
    checkAuth()
  }, [])

  return (
    <div className="flex items-center gap-6 text-sm text-[#71717a]">
      <Link
        href="/manifesto"
        className="hover:text-[#0a0a0a] transition-colors duration-300"
      >
        manifesto
      </Link>
      <a
        href="https://x.com/dsllwn/status/2015923879668044002"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-[#0a0a0a] transition-colors duration-300"
      >
        demo
      </a>
      <Link
        href="/pricing"
        className="hover:text-[#0a0a0a] transition-colors duration-300"
      >
        pricing
      </Link>
      {authState.authenticated ? (
        <Link
          href="/account"
          className="hover:text-[#0a0a0a] transition-colors duration-300"
        >
          account
        </Link>
      ) : (
        <Link
          href="/auth/sign-in"
          className="hover:text-[#0a0a0a] transition-colors duration-300"
        >
          sign in
        </Link>
      )}
    </div>
  )
}
