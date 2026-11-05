import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { MapQuestion } from '../lib/alignment-packs.js';
import type { DesignAnswer } from '../lib/design-review.js';
import type { Diagram } from './alignment-graph.js';
import { pack, targetLabel } from './pack.js';
import { useDesignReview } from './design-approval.js';
import { questionLocation } from './question-targets.js';
import { SidebarMarkdown } from './sidebar-markdown.js';

export type AnswerDraft = Omit<DesignAnswer, 'questionId'> & { other?: boolean };

export function useQuestionCounts(diagram: Diagram): Map<string, number> {
  const review = useDesignReview();
  const previous = useRef(new Map<string, number>());
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const question of pack.designDocument?.questions ?? []) {
      if (review ? review.answered.includes(question.id) : question.answer !== undefined) continue;
      const location = questionLocation(question, diagram, pack.graph);
      counts.set(location, (counts.get(location) ?? 0) + 1);
    }
    // Status refreshes must not replace measurement handles when counts did not change.
    if (counts.size === previous.current.size && [...counts].every(([id, count]) => previous.current.get(id) === count)) return previous.current;
    previous.current = counts;
    return counts;
  }, [diagram, review?.answered]);
}

export function DesignQuestions({ selected, diagram, drafts, onDraft, onDetails, focusQuestion, questions: sourceQuestions = pack.designDocument?.questions ?? [], scopeControl }: {
  questions?: MapQuestion[];
  scopeControl?: ReactNode;
  focusQuestion?: { id: string };
  selected: string | null; diagram: Diagram; drafts: Record<string, AnswerDraft>;
  onDraft: (id: string, draft?: AnswerDraft) => void; onDetails: (question: MapQuestion) => void;
}) {
  const review = useDesignReview();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const summaries = useRef(new Map<string, HTMLButtonElement>());
  const lastFocus = useRef<{ id: string } | undefined>(undefined);
  useEffect(() => {
    if (focusQuestion) setExpanded(previous => new Set([...previous, focusQuestion.id]));
  }, [focusQuestion]);
  useEffect(() => {
    if (!focusQuestion || !expanded.has(focusQuestion.id) || lastFocus.current === focusQuestion) return;
    const summary = summaries.current.get(focusQuestion.id);
    if (!summary) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    summary.focus({ preventScroll: true });
    summary.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    const card = summary.parentElement;
    const emphasis = { backgroundColor: 'var(--accent-soft)', boxShadow: 'inset 3px 0 0 var(--accent)' };
    card?.getAnimations().forEach(animation => animation.cancel());
    card?.animate([emphasis, reduced ? emphasis : { backgroundColor: 'transparent', boxShadow: 'inset 3px 0 0 transparent' }], { duration: 1600, easing: 'ease-out' });
    lastFocus.current = focusQuestion;
  }, [focusQuestion, expanded]);
  const questions = [...sourceQuestions].sort((a, b) => Number(questionLocation(b, diagram, pack.graph) === selected) - Number(questionLocation(a, diagram, pack.graph) === selected));
  const allExpanded = questions.length > 0 && questions.every(question => expanded.has(question.id));
  const [changing, setChanging] = useState<Set<string>>(new Set());
  const save = async (answer: DesignAnswer) => {
    if (!review) return;
    try {
      await review.saveAnswer(answer);
      onDraft(answer.questionId);
      setChanging(previous => { const next = new Set(previous); next.delete(answer.questionId); return next; });
      setErrors(previous => ({ ...previous, [answer.questionId]: '' }));
    } catch (error) { setErrors(previous => ({ ...previous, [answer.questionId]: error instanceof Error ? error.message : String(error) })); }
  };
  const isAnswered = (question: MapQuestion) => review ? review.answered.includes(question.id) : question.answer !== undefined;
  const open = questions.filter(question => !isAnswered(question));
  const answered = questions.filter(isAnswered);
  const card = (question: MapQuestion) => {
    const done = isAnswered(question);
    const editing = !done || changing.has(question.id);
    const previous = done ? answerDraft(question, review?.answerText(question.id) ?? question.answer ?? '') : { answer: '', choices: [], other: false };
    const draft = drafts[question.id] ?? previous;
    const text = question.choices && !draft.other ? '' : draft.answer.trim();
    const choices = question.choices?.filter(choice => draft.choices?.includes(choice));
    const count = (choices?.length ?? 0) + Number(Boolean(text));
    const valid = count > 0 && (!question.choices || question.multiple || count === 1) && (!question.choices || !draft.other || Boolean(text));
    const disabled = !review || review.pending;
    const expandedCard = expanded.has(question.id);
    const bodyId = `question-body-${question.id}`;
    const inputId = `question-answer-${question.id}`;
    const toggle = () => setExpanded(previous => { const next = new Set(previous); if (next.has(question.id)) next.delete(question.id); else next.add(question.id); return next; });
    const saved = review?.answerText(question.id) ?? question.answer;
    // A single chosen option reads as plain text, not a one-item list.
    const answerText = saved && /^- [^\n]*$/.test(saved) ? saved.slice(2) : saved;
    return <article key={question.id} className="question-card" data-question-id={question.id} data-answered={done || undefined} data-selected={questionLocation(question, diagram, pack.graph) === selected}>
      <button ref={node => { if (node) summaries.current.set(question.id, node); else summaries.current.delete(question.id); }} type="button" className="question-summary" aria-label={question.question} aria-expanded={expandedCard} aria-controls={bodyId} onClick={toggle}>
        {expandedCard ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span><span className="question-title">{done && <Check size={14} className="done-icon" aria-hidden="true" />}{question.question}</span><span className="question-meta">{targetLabel(question.target)}</span></span>
      </button>
      {expandedCard && <div id={bodyId} className="question-body">
        {question.detail && <div className="markdown"><SidebarMarkdown hideImages>{question.detail}</SidebarMarkdown></div>}
        <button type="button" className="link" aria-haspopup="dialog" onClick={() => onDetails(question)}>View target details</button>
        {done && !editing && <div className="question-answer">
          <p className="question-answer-label">Your answer</p>
          {answerText ? <div className="markdown"><SidebarMarkdown hideImages>{answerText}</SidebarMarkdown></div> : null}
          {review && <button type="button" className="btn" disabled={!review.canAnswer} onClick={() => setChanging(previous => new Set([...previous, question.id]))}>Change answer</button>}
        </div>}
        {editing && (question.choices ? <fieldset className="question-choices" disabled={disabled}>
          <legend>{question.multiple ? 'Select all that apply' : 'Choose one'}</legend>
          {question.choices.map(choice => <label key={choice}>
            <input type={question.multiple ? 'checkbox' : 'radio'} name={`question-${question.id}`} checked={draft.choices?.includes(choice) ?? false} onChange={event => {
              const selectedChoices = new Set(question.multiple ? draft.choices : []);
              if (event.target.checked) selectedChoices.add(choice); else selectedChoices.delete(choice);
              onDraft(question.id, { ...draft, choices: question.choices?.filter(item => selectedChoices.has(item)), ...(!question.multiple && { answer: '', other: false }) });
            }} />{choice}
          </label>)}
          <label><input type={question.multiple ? 'checkbox' : 'radio'} name={`question-${question.id}`} checked={Boolean(draft.other)} onChange={event => onDraft(question.id, { ...draft, other: event.target.checked, ...(!question.multiple && { choices: [] }) })} />Other</label>
          {draft.other && <><label htmlFor={inputId}>Your alternative</label><textarea id={inputId} rows={2} maxLength={16000} value={draft.answer} onChange={event => onDraft(question.id, { ...draft, answer: event.target.value })} /></>}
        </fieldset> : <div className="question-text-answer"><label htmlFor={inputId}>Your answer</label>
          <textarea id={inputId} value={draft.answer} maxLength={16000} rows={2} disabled={disabled} onChange={event => onDraft(question.id, { answer: event.target.value })} />
        </div>)}
        {errors[question.id] && <p className="error" role="alert">{errors[question.id]}</p>}
        {review && editing && <div className="row">
          <button type="button" className="btn" disabled={!review.canAnswer || !valid} onClick={() => void save({ questionId: question.id, answer: text, ...(choices && { choices }) })}>{review.pending ? 'Saving...' : done ? 'Save new answer' : 'Save answer'}</button>
          {done && <button type="button" className="btn ghost" onClick={() => { onDraft(question.id); setChanging(previous => { const next = new Set(previous); next.delete(question.id); return next; }); }}>Cancel</button>}
        </div>}
      </div>}
    </article>;
  };
  return <section className="design-questions" aria-label="Design questions">
    <div className="review-toolbar">{scopeControl ?? <h2>Questions</h2>}
      {questions.length > 0 && <button type="button" className="btn ghost" onClick={() => setExpanded(previous => {
        const next = new Set(previous);
        for (const question of questions) { if (allExpanded) next.delete(question.id); else next.add(question.id); }
        return next;
      })}>{allExpanded ? 'Collapse all' : 'Expand all'}</button>}
    </div>
    {!questions.length && <p className="muted">{pack.designDocument?.questions?.length ? 'No questions for this target.' : 'No questions for this design.'}</p>}
    {open.length > 0 && <div className="question-group">{answered.length > 0 && <h3 className="question-group-title">Open</h3>}{open.map(card)}</div>}
    {answered.length > 0 && <div className="question-group"><h3 className="question-group-title">Answered</h3>{answered.map(card)}</div>}
  </section>;
}

// Rebuild the form from a saved answer, which the server writes as `- choice` and `- Other: text` lines.
function answerDraft(question: MapQuestion, answer: string): AnswerDraft {
  if (!question.choices) return { answer };
  const lines = answer.split('\n').map(line => line.replace(/^- /, '').trim()).filter(Boolean);
  const other = lines.find(line => line.startsWith('Other: '))?.slice(7) ?? '';
  return { answer: other, choices: question.choices.filter(choice => lines.includes(choice)), other: Boolean(other) };
}
