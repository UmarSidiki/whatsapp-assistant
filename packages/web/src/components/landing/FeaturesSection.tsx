'use client';

import { motion, useReducedMotion } from 'framer-motion';
import {
  FiBarChart2,
  FiClock,
  FiCpu,
  FiFileText,
  FiGitBranch,
  FiMessageSquare,
  FiSend,
  FiSmartphone,
} from 'react-icons/fi';

const features = [
  {
    icon: FiSend,
    title: 'Bulk Messaging',
    description:
      'Send personalized messages to multiple contacts simultaneously with smart rate limiting and delivery tracking.',
  },
  {
    icon: FiMessageSquare,
    title: 'Auto-Reply System',
    description:
      'Set up intelligent automated responses based on keywords, time, and contact groups to never miss a message.',
  },
  {
    icon: FiClock,
    title: 'Message Scheduling',
    description:
      'Schedule messages for optimal delivery times across different time zones with automatic retry on failures.',
  },
  {
    icon: FiGitBranch,
    title: 'Flow Builder',
    description:
      'Create sophisticated conversation flows with conditional logic, branching paths, and dynamic content.',
  },
  {
    icon: FiCpu,
    title: 'AI Assistant',
    description:
      'Leverage AI-powered responses to handle customer inquiries intelligently and learn from interactions.',
  },
  {
    icon: FiFileText,
    title: 'Message Templates',
    description:
      'Design reusable message templates with variables, media attachments, and rich formatting options.',
  },
  {
    icon: FiBarChart2,
    title: 'Analytics Dashboard',
    description:
      'Track message delivery rates, engagement metrics, and conversation insights with detailed reporting.',
  },
  {
    icon: FiSmartphone,
    title: 'Multi-Device Support',
    description:
      'Seamlessly manage conversations across multiple devices with real-time synchronization and cloud backup.',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut' as const,
    },
  },
} as const;

export default function FeaturesSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section id="features" className="bg-gray-50 px-4 py-20 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -20 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6 }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 text-4xl font-bold text-gray-900 sm:text-5xl">Powerful Features</h2>
          <p className="mx-auto max-w-3xl text-xl text-gray-600">
            Everything you need to automate and scale your WhatsApp communication
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial={reduceMotion ? false : 'hidden'}
          whileInView={reduceMotion ? undefined : 'visible'}
          viewport={{ once: true, amount: 0.2 }}
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                variants={itemVariants}
                className="group relative rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all duration-300 hover:border-blue-200 hover:shadow-xl"
              >
                <div className="flex h-full flex-col">
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition-colors duration-300 group-hover:bg-blue-600 group-hover:text-white">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-gray-900 transition-colors duration-300 group-hover:text-blue-600">
                    {feature.title}
                  </h3>
                  <p className="flex-grow leading-relaxed text-gray-600">{feature.description}</p>
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
