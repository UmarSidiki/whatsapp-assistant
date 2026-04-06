'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const faqs = [
  {
    question: 'Can I test the platform before paying?',
    answer:
      'Yes. Both plans include a 7-day free trial so you can connect your account, validate your workflows, and make sure the platform fits your team.',
  },
  {
    question: 'Is the experience mobile friendly?',
    answer:
      'Absolutely. The entire landing experience and product flow are designed mobile-first, with responsive layouts and touch-friendly controls.',
  },
  {
    question: 'Does this support team collaboration?',
    answer:
      'The Management plan is built for shared ownership, routing, and visibility so multiple teammates can work conversations together.',
  },
  {
    question: 'How quickly can I launch?',
    answer:
      'Most teams can get started in a single session. Connect your WhatsApp account, pick a plan, and launch your first automation once everything is configured.',
  },
  {
    question: 'Can I change plans later?',
    answer:
      'Yes. You can start with Marketing and upgrade to Management whenever your workflow needs more collaboration and reporting.',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut' as const,
    },
  },
} as const;

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section
      id="faq"
      className="relative overflow-hidden bg-secondary/20 py-20 sm:py-24 lg:py-28"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-center"
        >
          <Badge variant="secondary" className="mb-4 rounded-full px-4 py-1">
            FAQ
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Common questions, answered
          </h2>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-lg">
            Everything you need to know about setup, pricing, and collaboration
            before you get started.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto mt-14 max-w-3xl space-y-4"
        >
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;

            return (
              <motion.div key={faq.question} variants={itemVariants}>
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm backdrop-blur transition-all duration-300 hover:shadow-lg">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex h-auto w-full items-center justify-between gap-4 px-5 py-5 text-left hover:bg-transparent sm:px-6"
                    onClick={() => setOpenIndex(isOpen ? -1 : index)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${index}`}
                  >
                    <span className="text-base font-semibold leading-6 text-foreground sm:text-lg">
                      {faq.question}
                    </span>
                    <motion.span
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ duration: 0.25 }}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </motion.span>
                  </Button>

                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        id={`faq-panel-${index}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: 'easeOut' as const }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 pt-0 sm:px-6">
                          <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                            {faq.answer}
                          </p>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
