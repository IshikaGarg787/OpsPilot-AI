import { Link } from 'react-router-dom';

export function Logo({ compact = false }: { compact?: boolean }) {
  return <Link className="brand" to="/" aria-label="OpsPilot AI home">
    <img className="brand-mark" src="/assets/opspilot-mark.png" alt="" aria-hidden="true" />
    {!compact && <span className="brand-name">OpsPilot <strong>AI</strong></span>}
  </Link>;
}
