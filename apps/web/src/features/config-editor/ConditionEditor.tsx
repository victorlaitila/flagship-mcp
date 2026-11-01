import {
  ACCOUNT_TYPES,
  OPERATOR_LABELS,
  OPERATORS,
  USER_ATTRIBUTE_LABELS,
  USER_ATTRIBUTES,
  type Condition,
  type Operator,
  type Segment,
  type UserAttribute,
} from '@flagship/shared';
import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, cx, Input, Select } from '../../components/ui';

const PLACEHOLDERS: Record<Exclude<UserAttribute, 'segment'>, string> = {
  userId: 'u_aino, u_eero',
  country: 'FI, SE',
  accountType: ACCOUNT_TYPES.join(', '),
};

/** Comma-separated values; keeps the raw text so typing a trailing comma works. */
function ValuesInput({ values, onChange, placeholder, disabled }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean }) {
  const [text, setText] = useState(values.join(', '));
  useEffect(() => {
    const parsed = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (parsed.join() !== values.join()) setText(values.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.join()]);
  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      aria-label="Values"
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
      }}
    />
  );
}

function SegmentPicker({ values, segments, onChange, disabled }: { values: string[]; segments: Segment[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {segments.map((s) => {
        const active = values.includes(s.key);
        return (
          <button
            key={s.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? values.filter((v) => v !== s.key) : [...values, s.key])}
            className={cx(
              'rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed',
              active ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line-strong text-muted hover:text-fg',
            )}
          >
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

export function ConditionRow({ condition, onChange, onRemove, segments, allowSegment, disabled }: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove?: () => void;
  segments: Segment[];
  allowSegment: boolean;
  disabled?: boolean;
}) {
  const attributes = USER_ATTRIBUTES.filter((a) => allowSegment || a !== 'segment');
  const setAttribute = (attribute: UserAttribute) =>
    onChange({ attribute, operator: attribute === 'segment' ? 'in' : condition.operator, values: [] });
  return (
    <div className="grid gap-2 sm:grid-cols-[140px_140px_1fr_auto] sm:items-start">
      <Select value={condition.attribute} disabled={disabled} aria-label="Attribute" onChange={(e) => setAttribute(e.target.value as UserAttribute)}>
        {attributes.map((a) => <option key={a} value={a}>{USER_ATTRIBUTE_LABELS[a]}</option>)}
      </Select>
      <Select value={condition.operator} disabled={disabled} aria-label="Operator" onChange={(e) => onChange({ ...condition, operator: e.target.value as Operator })}>
        {OPERATORS.map((o) => <option key={o} value={o}>{OPERATOR_LABELS[o]}</option>)}
      </Select>
      {condition.attribute === 'segment' ? (
        <SegmentPicker values={condition.values} segments={segments} disabled={disabled} onChange={(values) => onChange({ ...condition, values })} />
      ) : (
        <ValuesInput values={condition.values} disabled={disabled} placeholder={PLACEHOLDERS[condition.attribute]} onChange={(values) => onChange({ ...condition, values })} />
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={disabled} className="mt-1.5 justify-self-end rounded p-1 text-faint hover:bg-raised hover:text-danger disabled:opacity-40" aria-label="Remove condition">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function ConditionsEditor({ conditions, onChange, segments, allowSegment, disabled }: {
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
  segments: Segment[];
  allowSegment: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {conditions.map((c, i) => (
        <div key={i}>
          {i > 0 && <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">and</div>}
          <ConditionRow
            condition={c}
            segments={segments}
            allowSegment={allowSegment}
            disabled={disabled}
            onChange={(next) => onChange(conditions.map((x, j) => (j === i ? next : x)))}
            onRemove={conditions.length > 1 ? () => onChange(conditions.filter((_, j) => j !== i)) : undefined}
          />
        </div>
      ))}
      {!disabled && (
        <Button size="sm" variant="ghost" type="button" onClick={() => onChange([...conditions, { attribute: 'country', operator: 'equals', values: [] }])}>
          <Plus className="size-3.5" /> Add condition
        </Button>
      )}
    </div>
  );
}
