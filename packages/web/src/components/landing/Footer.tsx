'use client';

import { ArrowUpRight, MessageCircle, Phone } from 'lucide-react';
import { scrollToSection, scrollToTop } from '@/lib/scroll-utils';

const sectionLinks = [
  { label: 'Features', id: 'features' },
  { label: 'How it works', id: 'how-it-works' },
  { label: 'Pricing', id: 'pricing' },
  { label: 'FAQ', id: 'faq' },
];

export default function Footer() {
  return (
    <footer className="border-t border-border/70 bg-background py-12 sm:py-16">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr_1fr] lg:gap-12">
          <div className="space-y-5">
            <button
              type="button"
              onClick={() => scrollToTop()}
              className="inline-flex items-center gap-2 text-left text-xl font-bold tracking-tight text-foreground transition-colors hover:text-primary"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <MessageCircle className="h-5 w-5" />
              </span>
              WhatsApp Bot
            </button>
            <p className="max-w-md text-sm leading-7 text-muted-foreground sm:text-base">
              Automate marketing and management conversations with a responsive
              landing experience built for modern WhatsApp teams.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
              Explore
            </h3>
            <ul className="mt-5 space-y-3">
              {sectionLinks.map((link) => (
                <li key={link.id}>
                  <button
                    type="button"
                    onClick={() => scrollToSection(link.id, 80)}
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                    <ArrowUpRight className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
              Contact
            </h3>
            <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" />
                <span>Support available for onboarding and setup</span>
              </li>
              <li>
                <span>Built for mobile-first teams and fast-moving businesses.</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} WhatsApp Bot. All rights reserved.
          </p>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => scrollToSection('pricing', 80)}
              className="transition-colors hover:text-foreground"
            >
              View pricing
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('faq', 80)}
              className="transition-colors hover:text-foreground"
            >
              Read FAQ
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
