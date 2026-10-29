import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Logo({ compact = false }: { compact?: boolean }) {
  return <Link className="brand" to="/" aria-label="OpsPilot AI home">
    <span className="brand-mark"><Compass size={22} strokeWidth={2.2} /></span>
    {!compact && <span className="brand-name">OpsPilot <strong>AI</strong></span>}
  </Link>;
}
