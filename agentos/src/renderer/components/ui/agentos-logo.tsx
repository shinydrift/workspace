import React from 'react';
import agentOSLogoLight from '../../../../resources/agentos-logo.svg';
import agentOSLogoDark from '../../../../resources/agentos-logo-dark.svg';

interface Props {
  className?: string;
}

export function AgentOSLogo({ className = 'h-5 w-auto' }: Props) {
  return (
    <>
      <img src={agentOSLogoLight} alt="AgentOS" className={`block dark:hidden ${className}`} />
      <img src={agentOSLogoDark} alt="AgentOS" className={`hidden dark:block ${className}`} />
    </>
  );
}
