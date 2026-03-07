'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { PageNavbar } from '@/components/PageNavbar'

const manifestoBlocks = [
  'computers were meant to extend thought.',
  'instead, they interrupt it.',
  'a thought appears.\nyou switch apps to capture it.\nyou open tabs to answer it.\nyou move through software just to act on it.',
  'the work is no longer the work.\nthe work becomes navigating tools.',
  'we think that is backwards.',
  'humans are best at knowing what matters.\nsoftware is best at handling how.',
  'overlay exists to close that gap.',
  'it is not another destination.\nnot another workspace.\nnot another app asking for attention.',
  'it is a new interaction layer for personal computing.\none that appears when intent appears.\none that stays close to the flow of thought.',
  'because the best interface is not the one you visit.\nit is the one that meets you where you already are.',
  'overlay begins with a simple idea:',
  'the computer should adapt to humans,\nnot the other way around.',
  'speech is the fastest way to express intent.\noverlays remove the cost of navigation.\nai can now take natural, ambiguous input\nand turn it into structured action.',
  'together, these make a different kind of computer possible.',
  'one that is more contextual.\nmore conversational.\nmore coherent.',
  'less crowded.\nless compulsive.\nless chaotic.',
  'today, overlay helps you think without leaving your work.\nsoon, it will help you act with the same continuity.',
  'not by replacing your judgment.\nnot by hiding its steps.\nbut by helping the computer carry more of the operational burden.',
  'for too long, humans have been operators of software.',
  'overlay is built for something better:',
  'a world where humans are orchestrators of intent,\nand the computer handles the rest.',
  'you decide what matters.\noverlay handles how.',
] as const

export default function ManifestoPage() {
  return (
    <div className="min-h-screen gradient-bg flex flex-col">
      <div className="liquid-glass" />

      {/* Header */}
      <PageNavbar />

      {/* Main Content */}
      <main className="relative z-10 px-8 py-16 flex-1">
        <div className="max-w-3xl mx-auto">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-20"
          >
            <h1 className="text-5xl md:text-6xl font-serif mb-6">
              the overlay manifesto
            </h1>
            <p className="text-xl text-[var(--muted)] max-w-2xl mx-auto">
              a new interaction layer for personal computing
            </p>
          </motion.div>

          {/* Manifesto Content */}
          <motion.article
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-8"
          >
            {manifestoBlocks.map((block) => (
              <p
                key={block}
                className="whitespace-pre-line text-lg leading-relaxed text-[var(--muted)]"
              >
                {block}
              </p>
            ))}

            {/* CTA */}
            <section className="text-center pt-8">
              <Link
                href="/#download"
                className="inline-flex items-center gap-3 px-8 py-4 bg-[var(--foreground)] text-[var(--background)] rounded-full text-lg font-medium hover:opacity-90 transition-opacity"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                download overlay
              </Link>
              <p className="mt-4 text-sm text-[var(--muted)]">
                free to start. available for macos.
              </p>
            </section>
          </motion.article>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-8 px-8 border-t border-zinc-200 mt-auto">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-sm text-[var(--muted)]">
          <p>© 2026 overlay</p>
          <div className="flex gap-6">
            <Link href="/terms" className="hover:text-[var(--foreground)] transition-colors">
              terms
            </Link>
            <Link href="/privacy" className="hover:text-[var(--foreground)] transition-colors">
              privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
