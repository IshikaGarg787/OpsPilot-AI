import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Bot, ExternalLink, MessageCircle, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

type Message = { role: 'user' | 'assistant'; content: string; mode?: 'local_model' | 'static_data' | 'retrieval_only' };

const customerStarters = [
  'How do I track a ticket?',
  'What does my ticket status mean?',
  'I have an issue and need help',
];
const itStarters = [
  'Where do I find tickets assigned to me?',
  'How do I update a ticket for the customer?',
  'How do I check ticket SLA and priority?',
];

export function SupportChatWidget() {
  const { user } = useAuth();
  const isItTeam = user?.role === 'it_team';
  const starters = isItTeam ? itStarters : customerStarters;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function sendMessage(value: string) {
    const content = value.trim();
    if (!content || busy) return;
    const nextMessages: Message[] = [...messages, { role: 'user' as const, content }].slice(-12);
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);
    setError('');
    try {
      // The API caps each message at 2,000 characters. Keep the full reply in
      // the UI, but trim old assistant turns sent back as conversation context.
      const requestMessages = nextMessages.map(({ role, content }) => ({
        role,
        content: role === 'assistant' && content.length > 1800
          ? `${content.slice(0, 1800)}...`
          : content,
      }));
      const result = await api.supportChat.send(requestMessages);
      setMessages((current) => [...current, { role: 'assistant' as const, content: result.answer, mode: result.mode }].slice(-12));
    } catch (err) {
      setMessages((current) => current.filter((message, index) => !(index === current.length - 1 && message.role === 'user' && message.content === content)));
      setDraft(content);
      const validationIssues = err instanceof ApiError && Array.isArray(err.details)
        ? err.details.map((issue) => {
          if (!issue || typeof issue !== 'object') return '';
          const detail = issue as { path?: unknown[]; message?: unknown };
          return `${Array.isArray(detail.path) ? detail.path.join('.') : 'Message'}: ${typeof detail.message === 'string' ? detail.message : 'invalid value'}`;
        }).filter(Boolean).join('; ')
        : '';
      setError(err instanceof ApiError && err.status === 503
        ? 'Assistant is not configured or is temporarily unavailable. You can still raise a support ticket.'
        : validationIssues ? `Chat validation: ${validationIssues}`
          : err instanceof Error ? err.message : 'Could not send that message. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void sendMessage(draft); }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(draft); }
  }

  return (
    <div className="support-chat-widget">
      {open && <section className="support-chat-panel" aria-label="Pragya support chat">
        <header className="support-chat-header">
          <span className="support-chat-avatar"><Bot size={20} /></span>
          <span className="support-chat-heading"><strong>{isItTeam ? 'Pragya IT assistant' : 'Pragya assistant'}</strong><small><i /> Here to help · {isItTeam ? 'IT workspace' : 'Customer support'}</small></span>
          <button type="button" className="icon-button" aria-label="Close support chat" onClick={() => setOpen(false)}><X size={19} /></button>
        </header>
        <div className="support-chat-privacy"><ShieldCheck size={14} /> Ollama runs locally on the API host; no API key or external AI service is used. Replies use relevant help guidance and your authorized tickets. Don’t share secrets.</div>
        <div className="support-chat-messages" aria-live="polite" aria-relevant="additions text">
          {!messages.length && <div className="support-chat-welcome"><span><Sparkles size={19} /></span><strong>Hi{user?.name ? `, ${user.name.split(' ')[0]}` : ''}. What can I help with?</strong><p>{isItTeam ? 'I can help you find assigned work, update ticket status, reply to customers, and understand SLA or priority details.' : 'I can explain the portal and look up your tickets. For an issue that needs staff action, I can point you to ticket submission.'}</p><div className="support-chat-starters">{starters.map((starter) => <button key={starter} type="button" onClick={() => void sendMessage(starter)}>{starter}</button>)}</div></div>}
          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`support-chat-message support-chat-message-${message.role}`}><span>{message.role === 'assistant' ? <Bot size={15} /> : 'You'}</span><div className="support-chat-message-content">{message.mode === 'retrieval_only' && <small>Ollama unavailable · fallback answer</small>}{message.mode === 'static_data' && <small>Help and ticket records</small>}{message.mode === 'local_model' && <small>Local Ollama model</small>}<p>{message.content}</p></div></div>)}
          {busy && <div className="support-chat-typing"><i /><i /><i /><span>Searching help and your authorized tickets…</span></div>}
          <div ref={endRef} />
        </div>
        {error && <div className="support-chat-error" role="alert">{error}</div>}
        <div className="support-chat-ticket-link"><Link to="/app/tickets/new" onClick={() => setOpen(false)}>{isItTeam ? 'Report an internal issue' : 'Raise a support ticket'} <ExternalLink size={14} /></Link></div>
        <form className="support-chat-composer" onSubmit={submit}>
          <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} rows={1} maxLength={2000} placeholder={isItTeam ? 'Ask about your queue, ticket updates, or SLAs…' : 'Describe what you need help with…'} aria-label="Message the support assistant" />
          <button type="submit" aria-label="Send message" disabled={!draft.trim() || busy}><Send size={17} /></button>
        </form>
        <small className="support-chat-footnote">AI guidance can be wrong. Ticket updates and staff responses are authoritative.</small>
      </section>}
      <button type="button" className={`support-chat-launcher ${open ? 'is-open' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? 'Close support assistant' : 'Open support assistant'}>
        {open ? <X size={21} /> : <><MessageCircle size={20} /><span>Ask support</span></>}
      </button>
    </div>
  );
}
