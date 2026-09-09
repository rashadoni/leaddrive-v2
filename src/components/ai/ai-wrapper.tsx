import React, { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface AIWrapperProps {
  children: ReactNode;
  feature?: string;
}

/**
 * AIWrapper component for graceful degradation when AI features are unavailable.
 * Wraps AI-powered features and displays fallback UI if needed.
 */
export function AIWrapper({ children, feature = 'AI Feature' }: AIWrapperProps) {
  const [isSupported, setIsSupported] = React.useState(true);

  React.useEffect(() => {
    try {
      // Check if AI APIs are available
      const supported = typeof fetch !== 'undefined';
      setIsSupported(supported);
    } catch {
      setIsSupported(false);
    }
  }, []);

  if (!isSupported) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-800 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-yellow-900 dark:text-yellow-100">
              {feature} is currently unavailable
            </p>
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-1">
              This feature requires API connectivity. Please try again later or contact support.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default AIWrapper;
