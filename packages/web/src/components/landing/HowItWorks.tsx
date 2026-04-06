import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, MessageCircle, SendHorizontal, Settings2 } from 'lucide-react';

const steps = [
  {
    icon: Settings2,
    title: 'Set up automation',
    description: 'Connect your WhatsApp workflow, configure triggers, and define the rules that fit your business.',
  },
  {
    icon: MessageCircle,
    title: 'Design the conversation',
    description: 'Build clear paths for greetings, FAQs, lead capture, and follow-up messages in minutes.',
  },
  {
    icon: SendHorizontal,
    title: 'Launch and monitor',
    description: 'Publish your flow, track performance, and adjust messaging with live analytics and delivery status.',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' as const },
  },
} as const;

export default function HowItWorks() {
  const reduceMotion = useReducedMotion();

  return (
    <section id="how-it-works" className="px-4 py-20 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -16 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5 }}
          className="mx-auto mb-14 max-w-3xl text-center"
        >
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            How it works
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            A simple path from first message to fully automated support
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Set up your automation once, then let the platform handle the repetitive conversations.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial={reduceMotion ? false : 'hidden'}
          whileInView={reduceMotion ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.2 }}
          className="grid gap-6 lg:grid-cols-3"
        >
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <motion.article
                key={step.title}
                variants={itemVariants}
                className="relative overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-sm"
              >
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="h-7 w-7" />
                  </div>
                  <span className="text-5xl font-black text-primary/10">0{index + 1}</span>
                </div>
                <h3 className="text-2xl font-semibold text-foreground">{step.title}</h3>
                <p className="mt-3 text-muted-foreground">{step.description}</p>
                <div className="mt-6 flex items-center gap-2 text-sm font-medium text-foreground/80">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Ready in minutes
                </div>
              </motion.article>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
