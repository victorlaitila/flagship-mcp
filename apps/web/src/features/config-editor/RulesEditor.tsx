import { defaultVariantKey, type Flag, type Segment, type TargetingRule } from '@flagship/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, cx, Input, Select } from '../../components/ui';
import { ConditionsEditor } from './ConditionEditor';

const newRuleId = () => `r_${Math.random().toString(36).slice(2, 8)}`;

export function RulesEditor({ flag, rules, onChange, segments, disabled }: {
  flag: Flag;
  rules: TargetingRule[];
  onChange: (rules: TargetingRule[]) => void;
  segments: Segment[];
  disabled?: boolean;
}) {
  const update = (i: number, rule: TargetingRule) => onChange(rules.map((r, j) => (j === i ? rule : r)));
  const move = (i: number, by: number) => {
    const next = [...rules];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const add = () =>
    onChange([...rules, {
      id: newRuleId(), description: '', effect: 'include', variant: defaultVariantKey(flag),
      conditions: [{ attribute: 'segment', operator: 'in', values: [] }],
    }]);

  return (
    <div className="space-y-3">
      {rules.length === 0 && <p className="text-sm text-faint">No targeting rules. Every user gets the {flag.type === 'boolean' ? 'default' : 'rollout'} result.</p>}
      {rules.map((rule, i) => (
        <div
          key={rule.id}
          className={cx('rounded-md border bg-canvas/50 p-3 animate-slide-up', rule.effect === 'exclude' ? 'border-danger/25' : 'border-line-strong')}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={rule.effect === 'exclude' ? 'danger' : 'on'}>{i + 1}</Badge>
            <Select
              className="w-auto!"
              value={rule.effect}
              disabled={disabled}
              aria-label="Rule effect"
              onChange={(e) => {
                const effect = e.target.value as TargetingRule['effect'];
                update(i, { ...rule, effect, variant: effect === 'include' ? defaultVariantKey(flag) : null });
              }}
            >
              <option value="include">Include (serve on)</option>
              <option value="exclude">Exclude (serve off)</option>
            </Select>
            {flag.type === 'multivariate' && rule.effect === 'include' && (
              <Select className="w-auto!" value={rule.variant ?? ''} disabled={disabled} aria-label="Variant" onChange={(e) => update(i, { ...rule, variant: e.target.value })}>
                {flag.variants.map((v) => <option key={v.key} value={v.key}>→ {v.name}</option>)}
              </Select>
            )}
            <Input
              className="min-w-40 flex-1"
              value={rule.description}
              disabled={disabled}
              placeholder="Description (optional)"
              onChange={(e) => update(i, { ...rule, description: e.target.value })}
            />
            {!disabled && (
              <div className="flex items-center">
                <button type="button" className="rounded p-1.5 text-faint hover:bg-raised hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="size-3.5" /></button>
                <button type="button" className="rounded p-1.5 text-faint hover:bg-raised hover:text-fg disabled:opacity-30" disabled={i === rules.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="size-3.5" /></button>
                <button type="button" className="rounded p-1.5 text-faint hover:bg-raised hover:text-danger" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Delete rule"><Trash2 className="size-3.5" /></button>
              </div>
            )}
          </div>
          <ConditionsEditor
            conditions={rule.conditions}
            segments={segments}
            allowSegment
            disabled={disabled}
            onChange={(conditions) => update(i, { ...rule, conditions })}
          />
        </div>
      ))}
      {!disabled && (
        <Button type="button" size="sm" onClick={add}><Plus className="size-3.5" /> Add rule</Button>
      )}
      {rules.some((r) => r.effect === 'exclude') && (
        <p className="text-xs text-faint">Exclusions are checked before inclusions and always win. Inclusions apply in order; the first match is used.</p>
      )}
    </div>
  );
}
