import { createContext, createElement, useContext, type HTMLAttributes } from 'react';
import { ListTodo } from 'lucide-react';
import type { Components, ExtraProps } from 'react-markdown';
import type { DesignQuestion } from '../lib/alignment-packs.js';
import { Dropdown } from './dropdown.js';

export const QuestionReferenceContext = createContext<{ questions: DesignQuestion[]; onQuestion: (id: string) => void } | null>(null);

function Reference({ ids }: { ids: string[] }) {
  const navigation = useContext(QuestionReferenceContext);
  const questions = navigation?.questions.filter(question => ids.includes(question.id)) ?? [];
  if (!navigation || !questions.length) return null;
  if (questions.length === 1) return <button type="button" className="question-reference" title="View question" aria-label={`View question: ${questions[0].question}`} onMouseUp={event => event.stopPropagation()} onClick={() => navigation.onQuestion(questions[0].id)}><ListTodo size={16} aria-hidden="true" /></button>;
  return <span className="question-reference question-reference-picker" title="View questions" onMouseUp={event => event.stopPropagation()}>
    <Dropdown label={`View questions (${questions.length})`} value="" currentLabel={<><ListTodo size={14} aria-hidden="true" /><span>{questions.length}</span></>} options={questions.map(question => ({ value: question.id, label: question.question }))} onChange={navigation.onQuestion} />
  </span>;
}

function Passage({ tag, node, children, ...props }: HTMLAttributes<HTMLElement> & ExtraProps & { tag: string }) {
  const navigation = useContext(QuestionReferenceContext);
  const ids = String(node?.properties.dataQuestionIds ?? '').split(' ').filter(Boolean);
  const linked = navigation?.questions.some(question => ids.includes(question.id));
  const className = [props.className, linked ? 'question-passage' : '', tag === 'tr' && navigation ? 'question-row' : ''].filter(Boolean).join(' ');
  const reference = linked ? <Reference ids={ids} /> : null;
  if (tag === 'tr' && navigation) {
    const cell = node?.children.some(child => child.type === 'element' && child.tagName === 'th') ? 'th' : 'td';
    return createElement(tag, { ...props, className }, children, createElement(cell, { className: 'question-reference-cell', ...(cell === 'th' && { 'aria-label': 'Questions' }) }, reference));
  }
  return createElement(tag, { ...props, className: className || undefined }, children, reference);
}

export const passageComponents: Components = Object.fromEntries(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'].map(tag => [tag, (props: HTMLAttributes<HTMLElement> & ExtraProps) => <Passage {...props} tag={tag} />]));
