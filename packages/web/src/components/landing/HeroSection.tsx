import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight, Menu, MessageSquare, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: 'easeOut' as const,
    },
  },
} as const;

const imageVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.8,
      ease: 'easeOut' as const,
      delay: 0.3,
    },
  },
} as const;

export function HeroSection() {
  const reduceMotion = useReducedMotion();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <section
      id="hero"
      className="relative overflow-hidden bg-gradient-to-b from-background to-secondary/20 pt-4 pb-20 sm:pt-6 sm:pb-24 lg:pt-8 lg:pb-28"
    >
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 blur-3xl">
          <div className="aspect-[1155/678] w-[72.1875rem] bg-gradient-to-tr from-primary/20 to-accent/20 opacity-30" />
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between gap-4 rounded-full border border-border/60 bg-background/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <a href="#hero" className="flex items-center gap-2 font-semibold text-foreground">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <MessageSquare className="h-4 w-4" />
            </span>
            WhatsApp Bot
          </a>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a className="transition-colors hover:text-foreground" href="#features">
              Features
            </a>
            <a className="transition-colors hover:text-foreground" href="#how-it-works">
              How it works
            </a>
            <a className="transition-colors hover:text-foreground" href="#pricing">
              Pricing
            </a>
            <a className="transition-colors hover:text-foreground" href="#faq">
              FAQ
            </a>
          </nav>

          <div className="hidden items-center gap-3 sm:flex">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">Get started</Link>
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {mobileMenuOpen && (
          <div className="mb-6 rounded-2xl border border-border/60 bg-background/90 p-4 shadow-sm backdrop-blur md:hidden">
            <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
              <a
                className="rounded-md px-3 py-2 transition-colors hover:bg-muted hover:text-foreground"
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
              >
                Features
              </a>
              <a
                className="rounded-md px-3 py-2 transition-colors hover:bg-muted hover:text-foreground"
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
              >
                How it works
              </a>
              <a
                className="rounded-md px-3 py-2 transition-colors hover:bg-muted hover:text-foreground"
                href="#pricing"
                onClick={() => setMobileMenuOpen(false)}
              >
                Pricing
              </a>
              <a
                className="rounded-md px-3 py-2 transition-colors hover:bg-muted hover:text-foreground"
                href="#faq"
                onClick={() => setMobileMenuOpen(false)}
              >
                FAQ
              </a>
            </nav>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button asChild variant="outline" size="sm" onClick={() => setMobileMenuOpen(false)}>
                <Link to="/login">Log in</Link>
              </Button>
              <Button asChild size="sm" onClick={() => setMobileMenuOpen(false)}>
                <Link to="/signup">Get started</Link>
              </Button>
            </div>
          </div>
        )}

        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <motion.div
            variants={containerVariants}
            initial={reduceMotion ? false : 'hidden'}
            animate={reduceMotion ? false : 'visible'}
            className="text-center lg:text-left"
          >
            <motion.h1
              variants={itemVariants}
              className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl"
            >
              Automate Your{' '}
              <span className="text-primary">WhatsApp Business</span> Communication
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl md:text-2xl lg:mx-0"
            >
              Streamline customer interactions, send automated responses, and manage conversations
              at scale. Transform your WhatsApp into a powerful business tool with our intelligent
              automation platform.
            </motion.p>

            <motion.div
              variants={itemVariants}
              className="mt-10 flex flex-col justify-center gap-4 sm:flex-row lg:justify-start"
            >
              <Button asChild size="lg" className="h-auto px-8 py-6 text-base group">
                <Link to="/signup">
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>

              <Button asChild size="lg" variant="outline" className="h-auto px-8 py-6 text-base group">
                <a href="#how-it-works">
                  <Play className="mr-2 h-5 w-5 transition-transform group-hover:scale-110" />
                  View Demo
                </a>
              </Button>
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground lg:justify-start"
            >
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Free 7-day trial</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Cancel anytime</span>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            variants={imageVariants}
            initial={reduceMotion ? false : 'hidden'}
            animate={reduceMotion ? false : 'visible'}
            className="relative"
          >
            <div className="relative mx-auto aspect-square max-w-lg lg:max-w-none">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/20 via-accent/20 to-secondary/20 shadow-2xl">
                <div className="flex h-full items-center justify-center p-8">
                  <div className="space-y-4 text-center">
                    <div className="mx-auto max-w-sm rounded-2xl bg-white/90 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/90">
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <div className="max-w-[80%] rounded-lg rounded-tl-none bg-secondary p-3">
                            <p className="text-sm text-foreground">Hi! What are your business hours?</p>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <div className="max-w-[80%] rounded-lg rounded-tr-none bg-primary p-3 text-primary-foreground">
                            <p className="text-sm">We're open Mon-Fri, 9 AM - 6 PM! 🤖</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <div className="rounded-lg bg-secondary p-3">
                            <div className="flex gap-1">
                              <span
                                className={`h-2 w-2 rounded-full bg-muted-foreground/40 ${reduceMotion ? '' : 'animate-bounce'}`}
                                style={{ animationDelay: '0ms' }}
                              />
                              <span
                                className={`h-2 w-2 rounded-full bg-muted-foreground/40 ${reduceMotion ? '' : 'animate-bounce'}`}
                                style={{ animationDelay: '150ms' }}
                              />
                              <span
                                className={`h-2 w-2 rounded-full bg-muted-foreground/40 ${reduceMotion ? '' : 'animate-bounce'}`}
                                style={{ animationDelay: '300ms' }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-2 rounded-full bg-green-500/10 px-4 py-2 text-sm font-medium text-green-600 dark:text-green-400">
                      <span className="relative flex h-2 w-2">
                        <span
                          className={`absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${reduceMotion ? '' : 'animate-ping'}`}
                        />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                      </span>
                      Automated Response
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-primary/20 blur-2xl" />
              <div className="absolute -bottom-4 -left-4 h-32 w-32 rounded-full bg-accent/20 blur-2xl" />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
