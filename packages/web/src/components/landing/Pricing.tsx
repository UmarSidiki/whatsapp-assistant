import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const plans = [
  {
    name: 'Starter',
    price: '$19',
    description: 'For teams getting started with automated WhatsApp workflows.',
    features: ['1 workspace', '5 automations', 'Basic analytics', 'Email support'],
    highlighted: false,
  },
  {
    name: 'Growth',
    price: '$49',
    description: 'For growing teams that need scheduling, flows, and reporting.',
    features: ['Unlimited automations', 'Flow builder', 'Advanced analytics', 'Priority support'],
    highlighted: true,
  },
  {
    name: 'Scale',
    price: 'Custom',
    description: 'For high-volume teams that need tailored automation and onboarding.',
    features: ['Dedicated onboarding', 'Custom integrations', 'SLA support', 'Security review'],
    highlighted: false,
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
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' as const },
  },
} as const;

export default function Pricing() {
  const reduceMotion = useReducedMotion();

  return (
    <section id="pricing" className="bg-secondary/20 px-4 py-20 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -16 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5 }}
          className="mx-auto mb-14 max-w-3xl text-center"
        >
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Pricing
          </p>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Start free, then scale when your automation does
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Every plan starts with a 7-day trial so you can validate the fit before you commit.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial={reduceMotion ? false : 'hidden'}
          whileInView={reduceMotion ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.2 }}
          className="grid gap-6 lg:grid-cols-3"
        >
          {plans.map((plan) => (
            <motion.article
              key={plan.name}
              variants={itemVariants}
              className={`flex h-full flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300 sm:p-8 ${
                plan.highlighted
                  ? 'border-primary bg-background shadow-lg ring-1 ring-primary/20'
                  : 'border-border bg-card'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold text-foreground">{plan.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
                </div>
                {plan.highlighted ? (
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    Most popular
                  </span>
                ) : null}
              </div>

              <div className="mt-8 flex items-end gap-1">
                <span className="text-5xl font-bold tracking-tight text-foreground">{plan.price}</span>
                {plan.price !== 'Custom' ? <span className="pb-1 text-muted-foreground">/mo</span> : null}
              </div>

              <ul className="mt-8 space-y-4 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/10 text-green-600">
                      <Check className="h-4 w-4" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-1 items-end">
                <Button asChild className="w-full" variant={plan.highlighted ? 'default' : 'outline'}>
                  <Link to="/signup">Get Started</Link>
                </Button>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
