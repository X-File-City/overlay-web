'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Plus, Trash2, ChevronDown, Loader2, ImageIcon, X, AlertCircle, Check } from 'lucide-react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from '@/lib/models'
import { MarkdownMessage } from './MarkdownMessage'

interface Chat {
  _id: string
  title: string
  model: string
  lastModified: number
}

interface AttachedImage {
  dataUrl: string
  mimeType: string
  name: string
}

interface Entitlements {
  tier: 'free' | 'pro' | 'max'
  creditsUsed: number
  creditsTotal: number
  dailyUsage: { ask: number; write: number; agent: number }
  dailyLimits: { ask: number; write: number; agent: number }
}

function getMessageText(msg: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!msg.parts) return ''
  return msg.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text || '')
    .join('')
}

function getMessageImages(msg: { parts?: Array<{ type: string; image?: string }> }): string[] {
  if (!msg.parts) return []
  return msg.parts
    .filter((p) => p.type === 'image' && p.image)
    .map((p) => p.image!)
}

async function generateTitle(text: string): Promise<string | null> {
  try {
    const res = await fetch('/api/app/generate-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (res.ok) {
      const data = await res.json()
      return data.title || null
    }
  } catch {
    // ignore
  }
  return null
}

const CHAT_SUGGESTIONS = [
  'Explain how transformers work in machine learning',
  'Write a Python script to rename files in a folder',
  'What are the key differences between REST and GraphQL?',
  'Help me draft a professional email declining a meeting',
]

const CHAT_MODEL_KEY = 'overlay_chat_model'

export default function ChatInterface({ userId: _userId }: { userId: string }) {
  void _userId
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [selectedModels, setSelectedModels] = useState<string[]>([DEFAULT_MODEL_ID])

  useEffect(() => {
    const saved = localStorage.getItem(CHAT_MODEL_KEY)
    if (!saved) return
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) setSelectedModels(parsed.slice(0, 4))
    } catch {
      setSelectedModels([saved])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [activeViewedModelIdx, setActiveViewedModelIdx] = useState(0)
  // Per-exchange model tracking: index = exchange number, value = models used for that exchange
  const [exchangeModels, setExchangeModels] = useState<string[][]>([])
  // Which exchange (by index) is currently visible as user scrolls
  const [visibleExchangeIdx, setVisibleExchangeIdx] = useState(0)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [input, setInput] = useState('')
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([])
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const shouldScrollRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  // 4 fixed transport and chat instances (hooks cannot be conditional)
  const transport0 = useMemo(() => new DefaultChatTransport({ api: '/api/app/chat' }), [])
  const transport1 = useMemo(() => new DefaultChatTransport({ api: '/api/app/chat' }), [])
  const transport2 = useMemo(() => new DefaultChatTransport({ api: '/api/app/chat' }), [])
  const transport3 = useMemo(() => new DefaultChatTransport({ api: '/api/app/chat' }), [])

  const chat0 = useChat({ transport: transport0 })
  const chat1 = useChat({ transport: transport1 })
  const chat2 = useChat({ transport: transport2 })
  const chat3 = useChat({ transport: transport3 })

  const chatInstances = [chat0, chat1, chat2, chat3]

  // Clamp viewed index to valid range
  const safeViewIdx = Math.min(activeViewedModelIdx, selectedModels.length - 1)

  // Messages from the currently viewed model tab (used for scroll effect and tab visibility logic)
  const displayMessages = chatInstances[safeViewIdx].messages

  // Determine which models to show in the tabs for the currently visible exchange
  const visibleExchangeModels = exchangeModels[visibleExchangeIdx]
  // Show tabs only when the visible exchange used 2+ models AND at least one has an assistant response
  const visibleExchangeHasResponse =
    visibleExchangeModels != null &&
    chatInstances
      .slice(0, visibleExchangeModels.length)
      .some((c) => c.messages.filter((m) => m.role === 'assistant').length > visibleExchangeIdx)
  const showModelTabs = (visibleExchangeModels?.length ?? 0) > 1 && visibleExchangeHasResponse

  // isLoading: any selected model is loading
  const isAnyLoading = chatInstances
    .slice(0, selectedModels.length)
    .some((c) => c.status === 'streaming' || c.status === 'submitted')

  // Vision support: all selected models must support it
  const supportsVision = selectedModels.every(
    (modelId) => AVAILABLE_MODELS.find((m) => m.id === modelId)?.supportsVision ?? false
  )

  // Subscription state
  const isFreeTier = entitlements?.tier === 'free'
  const weeklyUsed = isFreeTier
    ? (entitlements?.dailyUsage.ask ?? 0) + (entitlements?.dailyUsage.write ?? 0) + (entitlements?.dailyUsage.agent ?? 0)
    : 0
  const weeklyLimitReached = isFreeTier && weeklyUsed >= 15
  const premiumModelBlocked =
    isFreeTier &&
    selectedModels.some((modelId) => AVAILABLE_MODELS.find((m) => m.id === modelId)?.provider !== 'openrouter')
  const creditsExhausted =
    !isFreeTier &&
    entitlements != null &&
    entitlements.creditsTotal > 0 &&
    entitlements.creditsUsed >= entitlements.creditsTotal * 100

  const isSendBlocked = weeklyLimitReached || premiumModelBlocked || creditsExhausted

  const loadSubscription = useCallback(async () => {
    try {
      const res = await fetch('/api/app/subscription')
      if (res.ok) setEntitlements(await res.json())
    } catch {
      // ignore
    }
  }, [])

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch('/api/app/chats')
      if (res.ok) setChats(await res.json())
    } catch {
      // ignore
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadChats(); loadSubscription() }, [loadChats, loadSubscription])

  // Refresh subscription after all selected models finish
  useEffect(() => {
    const allReady = chatInstances.slice(0, selectedModels.length).every((c) => c.status === 'ready')
    if (allReady && displayMessages.length > 0) {
      loadSubscription()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat0.status, chat1.status, chat2.status, chat3.status, displayMessages.length, loadSubscription])

  // Only scroll when the user explicitly sends a message — not during streaming
  useEffect(() => {
    if (shouldScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      shouldScrollRef.current = false
    }
  }, [displayMessages])

  // Close model picker on outside click
  useEffect(() => {
    if (!showModelPicker) return
    function handleOutside(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showModelPicker])

  function handleMessagesScroll() {
    const container = messagesScrollRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const threshold = containerRect.top + containerRect.height * 0.6
    const userEls = container.querySelectorAll<HTMLElement>('[data-exchange-idx]')
    let newIdx = 0
    for (const el of userEls) {
      if (el.getBoundingClientRect().top <= threshold) {
        newIdx = parseInt(el.getAttribute('data-exchange-idx') || '0', 10)
      }
    }
    setVisibleExchangeIdx(newIdx)
  }

  async function createNewChat(): Promise<string | null> {
    const res = await fetch('/api/app/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModels[0] }),
    })
    if (res.ok) {
      const data = await res.json()
      setActiveChatId(data.id)
      setIsFirstMessage(true)
      setExchangeModels([])
      setVisibleExchangeIdx(0)
      chatInstances.forEach((c) => c.setMessages([]))
      await loadChats()
      return data.id
    }
    return null
  }

  async function loadChat(chatId: string) {
    setActiveChatId(chatId)
    setIsFirstMessage(false)
    setActiveViewedModelIdx(0)
    setExchangeModels([])
    setVisibleExchangeIdx(0)
    try {
      const res = await fetch(`/api/app/chats?chatId=${chatId}&messages=true`)
      if (res.ok) {
        const data = await res.json()
        chat0.setMessages(data.messages || [])
        chat1.setMessages([])
        chat2.setMessages([])
        chat3.setMessages([])
      }
    } catch {
      chat0.setMessages([])
    }
  }

  async function deleteChat(chatId: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/app/chats?chatId=${chatId}`, { method: 'DELETE' })
    if (activeChatId === chatId) {
      setActiveChatId(null)
      setExchangeModels([])
      setVisibleExchangeIdx(0)
      chatInstances.forEach((c) => c.setMessages([]))
    }
    await loadChats()
  }

  function addImages(files: FileList | File[]) {
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        setAttachedImages((prev) => [...prev, { dataUrl, mimeType: file.type, name: file.name }])
      }
      reader.readAsDataURL(file)
    })
  }

  function handlePaste(e: React.ClipboardEvent) {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f != null)
    if (imageFiles.length > 0) {
      e.preventDefault()
      addImages(imageFiles)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if ((!text && attachedImages.length === 0) || isAnyLoading || isSendBlocked) return

    const chatId = activeChatId || await createNewChat()
    if (!chatId) return

    const wasFirst = isFirstMessage
    setInput('')
    setAttachedImages([])
    setIsFirstMessage(false)
    shouldScrollRef.current = true
    // Record which models are being used for this exchange
    setExchangeModels((prev) => [...prev, [...selectedModels]])

    const parts: Array<{ type: string; text?: string; image?: string; mediaType?: string }> = []
    if (text) parts.push({ type: 'text', text })
    for (const img of attachedImages) {
      parts.push({ type: 'image', image: img.dataUrl, mediaType: img.mimeType })
    }

    // Send to all selected models in parallel.
    // Only the primary model (index 0) gets chatId so the user message and its response are
    // persisted once. Additional models stream transiently to avoid duplicate user messages.
    await Promise.all(
      selectedModels.map((modelId, idx) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chatInstances[idx].sendMessage({ role: 'user', parts: parts as any }, { body: { modelId, chatId, skipUserMessage: idx !== 0 } })
      )
    )

    loadChats()
    if (wasFirst && text) {
      generateTitle(text).then((title) => {
        if (title) {
          fetch('/api/app/chats', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId, title }),
          }).then(() => loadChats())
        }
      })
    }
  }

  function toggleModel(modelId: string) {
    const isSelected = selectedModels.includes(modelId)
    if (isSelected) {
      if (selectedModels.length === 1) return // must keep at least 1
      const newModels = selectedModels.filter((id) => id !== modelId)
      setSelectedModels(newModels)
      localStorage.setItem(CHAT_MODEL_KEY, JSON.stringify(newModels))
      if (activeViewedModelIdx >= newModels.length) {
        setActiveViewedModelIdx(newModels.length - 1)
      }
    } else {
      if (selectedModels.length >= 4) return // max 4
      const newIdx = selectedModels.length // index the new model will occupy
      // Seed the new model's chat instance with the currently-viewed model's conversation
      // so it has full context on the next send
      chatInstances[newIdx].setMessages(chatInstances[safeViewIdx].messages)
      const newModels = [...selectedModels, modelId]
      setSelectedModels(newModels)
      localStorage.setItem(CHAT_MODEL_KEY, JSON.stringify(newModels))
    }
  }

  function stopAll() {
    chatInstances.slice(0, selectedModels.length).forEach((c) => c.stop())
  }

  const activeChat = chats.find((c) => c._id === activeChatId)

  const modelPickerLabel =
    selectedModels.length === 1
      ? (AVAILABLE_MODELS.find((m) => m.id === selectedModels[0])?.name || 'Select model')
      : `${selectedModels.length} models`

  return (
    <div className="flex h-full">
      {/* Chat history sidebar */}
      <div className="w-52 h-full flex flex-col border-r border-[#e5e5e5] bg-[#f5f5f5]">
        <div className="flex h-16 items-center border-b border-[#e5e5e5] px-3">
          <button
            onClick={createNewChat}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm bg-[#0a0a0a] text-[#fafafa] hover:bg-[#222] transition-colors"
          >
            <Plus size={13} />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {chats.map((chat) => (
            <div
              key={chat._id}
              onClick={() => loadChat(chat._id)}
              className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
                activeChatId === chat._id
                  ? 'bg-[#e8e8e8] text-[#0a0a0a]'
                  : 'text-[#525252] hover:bg-[#ebebeb] hover:text-[#0a0a0a]'
              }`}
            >
              <span className="truncate">{chat.title}</span>
              <button
                onClick={(e) => deleteChat(chat._id, e)}
                className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded hover:bg-[#d8d8d8] transition-opacity"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-[#e5e5e5] px-4">
          <h2 className="text-sm font-medium text-[#0a0a0a] truncate max-w-[30%]">
            {activeChat?.title || 'New conversation'}
          </h2>

          {/* Model tabs — shown in center only after a response has been generated for a multi-model exchange */}
          {showModelTabs && (
            <div className="flex items-center gap-1.5 flex-1 justify-center px-4">
              {visibleExchangeModels!.map((modelId, idx) => {
                const model = AVAILABLE_MODELS.find((m) => m.id === modelId)
                const isViewing = idx === safeViewIdx
                const tabLoading =
                  chatInstances[idx].status === 'streaming' || chatInstances[idx].status === 'submitted'
                return (
                  <button
                    key={modelId}
                    onClick={() => setActiveViewedModelIdx(idx)}
                    disabled={tabLoading}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${
                      isViewing
                        ? 'bg-[#0a0a0a] text-[#fafafa]'
                        : tabLoading
                        ? 'bg-[#f0f0f0] text-[#aaa] cursor-not-allowed'
                        : 'bg-[#f0f0f0] text-[#525252] hover:bg-[#e8e8e8]'
                    }`}
                  >
                    {tabLoading && <Loader2 size={9} className="animate-spin" />}
                    {model?.name || modelId}
                  </button>
                )
              })}
            </div>
          )}

          {/* Model picker */}
          <div ref={modelPickerRef} className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-[#f0f0f0] text-[#525252] hover:bg-[#e8e8e8] transition-colors"
            >
              {modelPickerLabel}
              <ChevronDown size={11} />
            </button>
            {showModelPicker && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-[#e5e5e5] rounded-lg shadow-lg z-10 py-1 max-h-72 overflow-y-auto">
                {AVAILABLE_MODELS.map((m) => {
                  const isSelected = selectedModels.includes(m.id)
                  const isDisabled = !isSelected && selectedModels.length >= 4
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleModel(m.id)}
                      disabled={isDisabled}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between ${
                        isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#f5f5f5]'
                      } ${isSelected ? 'text-[#0a0a0a] font-medium' : 'text-[#525252]'}`}
                    >
                      <span className="flex items-center gap-2">
                        {isSelected ? <Check size={10} /> : <span className="w-[10px] inline-block" />}
                        {m.name}
                      </span>
                      <span className="text-[#aaa] ml-2">{m.provider}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesScrollRef} className="flex-1 overflow-y-auto px-4 py-4" onScroll={handleMessagesScroll}>
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4">
            {displayMessages.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center max-w-xl">
                  <p className="text-3xl mb-3" style={{ fontFamily: 'var(--font-instrument-serif)' }}>
                    chat
                  </p>
                  <p className="text-sm text-[#888] mb-6">Start a conversation with any AI model</p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-[#525252]">
                    {CHAT_SUGGESTIONS.map((prompt) => (
                      <button
                        key={prompt}
                        className="text-left p-2.5 rounded-lg border border-[#e5e5e5] hover:bg-[#f5f5f5] transition-colors"
                        onClick={() => setInput(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {chatInstances.map((chatInst, idx) => {
              if (idx >= selectedModels.length) return null
              const isActive = idx === safeViewIdx
              const msgs = chatInst.messages
              let userCount = 0
              const msgsWithExch = msgs.map((msg) => {
                const exchangeIdx = msg.role === 'user' ? userCount : userCount - 1
                if (msg.role === 'user') userCount++
                return { msg, exchangeIdx }
              })
              const lastMsg = msgs[msgs.length - 1]
              const instLoading = chatInst.status === 'streaming' || chatInst.status === 'submitted'
              const showInstLoading = instLoading && !(lastMsg?.role === 'assistant' && getMessageText(lastMsg).trim().length > 0)
              const instError = chatInst.error
              const instErrorMessage = instError
                ? (instError.message?.includes('weekly_limit')
                    ? 'Weekly limit reached — upgrade to Pro for unlimited messages.'
                    : instError.message?.includes('premium_model')
                    ? 'This model requires a Pro subscription.'
                    : instError.message?.includes('insufficient_credits')
                    ? 'No credits remaining.'
                    : 'Something went wrong. Please try again.')
                : null
              return (
                <div key={idx} style={isActive ? undefined : { display: 'none' }}>
                  {msgsWithExch.map(({ msg, exchangeIdx }) => {
                    const text = getMessageText(msg)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const images = getMessageImages(msg as any)
                    return (
                      <div
                        key={msg.id}
                        data-exchange-idx={msg.role === 'user' && isActive ? exchangeIdx : undefined}
                        className={`flex message-appear ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'assistant' ? (
                          <div className="w-full px-1 py-1 text-sm leading-relaxed text-[#0a0a0a]">
                            <MarkdownMessage
                              text={text}
                              isStreaming={instLoading && msg.id === lastMsg?.id}
                            />
                          </div>
                        ) : (
                          <div className="max-w-[75%] space-y-2">
                            {images.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 justify-end">
                                {images.map((src, i) => (
                                  <img
                                    key={i}
                                    src={src}
                                    alt="attached"
                                    className="max-w-[200px] max-h-[200px] rounded-xl object-cover"
                                  />
                                ))}
                              </div>
                            )}
                            {text && (
                              <div className="rounded-2xl rounded-br-sm bg-[#0a0a0a] px-4 py-2.5 text-sm leading-relaxed text-[#fafafa]">
                                <span className="whitespace-pre-wrap">{text}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {showInstLoading && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-2 px-1 py-1 text-xs italic text-[#888]">
                        <Loader2 size={12} className="animate-spin" />
                        Thinking...
                      </div>
                    </div>
                  )}
                  {instErrorMessage && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs">
                        <AlertCircle size={12} />
                        {instErrorMessage}
                      </div>
                    </div>
                  )}
                  {isActive && <div ref={messagesEndRef} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* Input */}
        <div className="px-4 pb-4">
          {/* Image previews */}
          {attachedImages.length > 0 && (
            <div className="mx-auto w-full max-w-4xl mb-2 flex flex-wrap gap-2">
              {attachedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="w-16 h-16 object-cover rounded-lg border border-[#e5e5e5]"
                  />
                  <button
                    onClick={() => setAttachedImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#0a0a0a] text-[#fafafa] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mx-auto w-full max-w-4xl">
            {isSendBlocked && !isAnyLoading ? (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#fafafa] border border-[#e5e5e5] text-xs text-[#888]">
                <AlertCircle size={13} className="text-amber-500 shrink-0" />
                {weeklyLimitReached
                  ? 'Weekly limit reached. Upgrade to Pro for unlimited messages.'
                  : premiumModelBlocked
                  ? 'This model requires Pro. Switch to a free model or upgrade.'
                  : 'No credits remaining. Please top up your account.'}
              </div>
            ) : (
              <div className="flex items-end gap-2 bg-[#f0f0f0] rounded-2xl px-4 py-3">
                {supportsVision && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => e.target.files && addImages(e.target.files)}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="shrink-0 p-1 text-[#aaa] hover:text-[#525252] transition-colors"
                      title="Attach image"
                    >
                      <ImageIcon size={15} />
                    </button>
                  </>
                )}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Message..."
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  className="flex-1 bg-transparent text-sm text-[#0a0a0a] placeholder-[#aaa] resize-none outline-none max-h-32"
                />
                {isAnyLoading ? (
                  <button
                    onClick={stopAll}
                    className="shrink-0 p-1.5 rounded-lg bg-[#0a0a0a] text-[#fafafa] hover:bg-[#333] transition-colors"
                    title="Stop generating"
                  >
                    <div className="w-3.5 h-3.5 bg-[#fafafa] rounded-sm" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && attachedImages.length === 0}
                    className="shrink-0 p-1.5 rounded-lg bg-[#0a0a0a] text-[#fafafa] disabled:opacity-40 hover:bg-[#333] transition-colors"
                  >
                    <Send size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
