import { motion, useReducedMotion } from 'framer-motion';

const faqs = [
  {
    question: 'Can I try the platform before paying?',
    answer: 'Yes. Every plan includes a 7-day trial so you can test the workflows, analytics, and messaging setup first.',
  },
  {
    question: 'Do I need technical skills to use it?',
    answer: 'No. The landing experience and product flows are designed for business users, with simple configuration and guided setup.',
  },
  {
    question: 'Can I switch plans later?',
    answer: 'Absolutely. You can start small and upgrade when your message volume or automation needs grow.',
  },
  {
    question: 'Is there a login page?',
    answer: 'Yes. You can always sign in at /login, or go straight to /signup to create a new account.',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: 'easeOut' as const },
  },
} as const;

export default function FAQ() {
  const reduceMotion = useReducedMotion();

  return (
    <section id="faq" className="px-4 py-20 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-4xl">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -16 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5 }}
          className="mx-auto mb-10 max-w-3xl text-center"
        >
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            FAQ
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Common questions answered
          </h2>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial={reduceMotion ? false : 'hidden'}
          whileInView={reduceMotion ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.2 }}
          className="space-y-4"
        >
          {faqs.map((faq) => (
            <motion.details
              key={faq.question}
              variants={itemVariants}
              className="group rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <summary className="cursor-pointer list-none text-lg font-semibold text-foreground marker:hidden">
                {faq.question}
              </summary>
              <p className="mt-3 text-muted-foreground">{faq.answer}</p>
            </motion.details>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
