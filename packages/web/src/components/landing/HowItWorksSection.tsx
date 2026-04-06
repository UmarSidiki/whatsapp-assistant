'use client';

import { motion } from 'framer-motion';
import { ArrowRight, MessageSquareMore, Puzzle, Rocket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

const steps = [
  {
    icon: MessageSquareMore,
    title: 'Connect your WhatsApp account',
    description:
      'Link your number in a few guided steps and bring your existing conversations into one secure workspace.',
    label: 'Step 01',
  },
  {
    icon: Puzzle,
    title: 'Build automations and workflows',
    description:
      'Create rules, autoresponders, templates, and flow branches that match the way your team communicates.',
    label: 'Step 02',
  },
  {
    icon: Rocket,
    title: 'Launch, monitor, and improve',
    description:
      'Go live with confidence, track activity in real time, and refine your campaigns as results come in.',
    label: 'Step 03',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.55,
      ease: 'easeOut' as const,
    },
  },
} as const;

export default function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden bg-gradient-to-b from-background via-background to-secondary/20 py-20 sm:py-24 lg:py-28"
    >
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 blur-3xl">
          <div className="aspect-[1155/678] w-[72rem] bg-gradient-to-tr from-primary/15 via-accent/10 to-secondary/20 opacity-40" />
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-center"
        >
          <Badge variant="secondary" className="mb-4 rounded-full px-4 py-1">
            How it works
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            A simple workflow for faster WhatsApp operations
          </h2>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-lg">
            Set up your account, automate repetitive work, and keep your team in
            sync with a flexible experience that scales from first launch to
            everyday operations.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-14 grid gap-6 lg:grid-cols-3"
        >
          {steps.map((step, index) => {
            const Icon = step.icon;

            return (
              <motion.div key={step.title} variants={itemVariants} className="relative">
                <Card className="group h-full border-border/70 bg-card/80 shadow-sm backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
                  <CardHeader className="space-y-5 p-6 sm:p-7">
                    <div className="flex items-center justify-between gap-4">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="h-6 w-6" />
                      </div>
                      <span className="text-sm font-medium text-muted-foreground">
                        {step.label}
                      </span>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                        {step.title}
                      </h3>
                      <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                        {step.description}
                      </p>
                    </div>
                  </CardHeader>

                  <CardContent className="px-6 pb-6 sm:px-7 sm:pb-7">
                    <div className="flex items-center gap-3 text-sm font-medium text-primary">
                      <span>Built for mobile-first teams</span>
                      <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                    </div>
                  </CardContent>
                </Card>

                {index < steps.length - 1 ? (
                  <div className="mx-auto mt-6 hidden h-6 w-px bg-border lg:block" />
                ) : null}
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
