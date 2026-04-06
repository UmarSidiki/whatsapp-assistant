import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly scrolls to a section with the given ID
 * @param id - The ID of the element to scroll to (without the # prefix)
 * @param offset - Optional offset from the top in pixels (default: 0)
 */
export function scrollToSection(id: string, offset: number = 0): void {
  const element = document.getElementById(id);
  
  if (!element) {
    console.warn(`Element with id "${id}" not found`);
    return;
  }

  const elementPosition = element.getBoundingClientRect().top + window.scrollY;
  const offsetPosition = elementPosition - offset;

  window.scrollTo({
    top: offsetPosition,
    behavior: 'smooth',
  });
}

interface UseScrollAnimationOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
}

interface UseScrollAnimationReturn {
  ref: React.RefObject<HTMLElement | null>;
  isVisible: boolean;
}

/**
 * Hook that triggers animations when elements enter the viewport using Intersection Observer
 * @param options - Configuration options for the Intersection Observer
 * @returns Object containing ref to attach to element and visibility state
 * 
 * @example
 * ```tsx
 * const { ref, isVisible } = useScrollAnimation({ threshold: 0.2, triggerOnce: true });
 * 
 * return (
 *   <div 
 *     ref={ref} 
 *     className={`transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
 *   >
 *     Content that animates in
 *   </div>
 * );
 * ```
 */
export function useScrollAnimation(
  options: UseScrollAnimationOptions = {}
): UseScrollAnimationReturn {
  const {
    threshold = 0.1,
    rootMargin = '0px',
    triggerOnce = false,
  } = options;

  const ref = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    // If user prefers reduced motion, show element immediately
    if (prefersReducedMotion) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          
          // If triggerOnce is true, disconnect observer after first trigger
          if (triggerOnce) {
            observer.disconnect();
          }
        } else if (!triggerOnce) {
          // Only update visibility if not triggerOnce mode
          setIsVisible(false);
        }
      },
      {
        threshold,
        rootMargin,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, triggerOnce]);

  return { ref, isVisible };
}

/**
 * Scrolls to the top of the page smoothly
 */
export function scrollToTop(): void {
  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
}

/**
 * Hook to track scroll position
 * @returns Current scroll position (Y axis)
 */
export function useScrollPosition(): number {
  const [scrollPosition, setScrollPosition] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return scrollPosition;
}
