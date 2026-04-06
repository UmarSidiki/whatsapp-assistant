'use client';

import { motion } from 'framer-motion';
import { Check, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const plans = [
  {
    name: 'Marketing',
    description: 'For campaigns, promotions, and audience engagement.',
    price: 'Flexible pricing',
    highlight: false,
    features: [
      'Campaign broadcasts and audience segments',
      'Message templates with personalization',
      'Delivery tracking and basic analytics',
      'Automations for replies and follow-ups',
      '7-day free trial',
    ],
    cta: 'Start marketing trial',
  },
  {
    name: 'Management',
    description: 'For teams handling support, operations, and workflows.',
    price: 'Most popular plan',
    highlight: true,
    features: [
      'Shared inbox for team collaboration',
      'Advanced routing and workflow automation',
      'Role-based permissions and visibility',
      'Detailed reporting and conversation history',
      '7-day free trial',
    ],
    cta: 'Start management trial',
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

export default function PricingSection() {
  return (
    <section
      id="pricing"
      className="relative overflow-hidden bg-background py-20 sm:py-24 lg:py-28"
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
            Pricing
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Pick the plan that fits your team
          </h2>
          <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-lg">
            Both plans include a 7-day free trial so you can test the workflow,
            refine your setup, and launch only when you are ready.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-14 grid gap-6 lg:grid-cols-2"
        >
          {plans.map((plan) => (
            <motion.div key={plan.name} variants={itemVariants} className="h-full">
              <Card
                className={`relative flex h-full flex-col overflow-hidden border-border/70 bg-card/80 shadow-sm backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${
                  plan.highlight ? 'border-primary/40 ring-1 ring-primary/20' : ''
                }`}
              >
                {plan.highlight ? (
                  <div className="absolute inset-x-0 top-0 flex justify-center px-6 pt-6">
                    <Badge className="rounded-full bg-primary px-3 py-1 text-primary-foreground shadow-sm">
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      Most Popular
                    </Badge>
                  </div>
                ) : null}

                <CardHeader className={`${plan.highlight ? 'pt-14' : 'pt-6'} space-y-3`}>
                  <CardTitle className="text-2xl text-foreground">
                    {plan.name}
                  </CardTitle>
                  <CardDescription className="text-sm leading-7 text-muted-foreground">
                    {plan.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col">
                  <div className="space-y-2">
                    <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                      {plan.price}
                    </p>
                    <p className="text-4xl font-bold tracking-tight text-foreground">
                      7-day free trial
                    </p>
                  </div>

                  <Separator className="my-6" />

                  <ul className="space-y-4">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Check className="h-4 w-4" />
                        </span>
                        <span className="text-sm leading-6 text-muted-foreground sm:text-base">
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter className="pt-0">
                  <Button
                    size="lg"
                    className="w-full"
                    variant={plan.highlight ? 'default' : 'outline'}
                  >
                    {plan.cta}
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
