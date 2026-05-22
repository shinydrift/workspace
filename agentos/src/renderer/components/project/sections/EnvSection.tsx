import React, { useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import { CustomVarRow } from '../../CustomVarRow';

interface Props {
  safelist: string[];
  appSafelist: string[];
  vars: Record<string, string>;
  appVars: Record<string, string>;
  savingKey: string | null;
  onChange: (safelist: string[]) => void;
  onVarsChange: (vars: Record<string, string>) => void;
}

export function EnvSection({ safelist, appSafelist, vars, appVars, savingKey, onChange, onVarsChange }: Props) {
  const [allVars, setAllVars] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const v = await window.electronAPI.env.listShellVars();
      setAllVars(v);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggle(name: string, on: boolean) {
    if (on) {
      onChange([...safelist, name]);
    } else {
      onChange(safelist.filter((n) => n !== name));
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allVars.filter((v) => !q || v.toLowerCase().includes(q));
  }, [allVars, search]);

  const selected = filtered.filter((v) => safelist.includes(v));
  const unselected = filtered.filter((v) => !safelist.includes(v));

  function setVar(key: string, value: string) {
    onVarsChange({ ...vars, [key]: value });
  }

  function renameVar(oldKey: string, newKey: string) {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      updated[k === oldKey ? trimmed : k] = v;
    }
    onVarsChange(updated);
  }

  function removeVar(key: string) {
    const updated = { ...vars };
    delete updated[key];
    onVarsChange(updated);
  }

  function addVar() {
    let n = 1;
    while (`VAR_${n}` in vars || `VAR_${n}` in appVars) n++;
    onVarsChange({ ...vars, [`VAR_${n}`]: '' });
  }

  return (
    <>
      <SectionHeader
        title="Environment"
        description="Select host shell variables to forward into containers. Project additions merge with app-level selections."
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
          />
          <Input
            placeholder="Filter variables…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => void load()}
          title="Refresh"
          aria-label="Refresh environment variables"
        >
          <ArrowClockwise size={14} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        {loading && allVars.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">Loading shell environment…</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">No variables match</p>
        ) : (
          <div className="overflow-y-auto max-h-80">
            <div className="divide-y divide-border">
              {selected.map((name) => (
                <VarRow
                  key={name}
                  name={name}
                  checked={true}
                  inherited={appSafelist.includes(name)}
                  onToggle={toggle}
                />
              ))}
              {selected.length > 0 && unselected.length > 0 && (
                <div className="px-3 py-1 bg-muted/40">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available</span>
                </div>
              )}
              {unselected.map((name) => (
                <VarRow
                  key={name}
                  name={name}
                  checked={appSafelist.includes(name)}
                  inherited={appSafelist.includes(name)}
                  onToggle={toggle}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {(safelist.length > 0 || appSafelist.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {appSafelist.length > 0 && `${appSafelist.length} from app`}
          {appSafelist.length > 0 && safelist.length > 0 && ', '}
          {safelist.length > 0 && `${safelist.length} added by this project`}
        </p>
      )}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs font-medium">Custom Variables</p>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={addVar} title="Add variable">
          <Plus size={13} />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground -mt-1">
        Key=value pairs injected directly into containers. Project values override app values for the same key.
      </p>

      {(Object.keys(appVars).length > 0 || Object.keys(vars).length > 0) && (
        <div className="border border-border rounded-md divide-y divide-border">
          {Object.entries(appVars)
            .filter(([k]) => !(k in vars))
            .map(([key, value]) => (
              <InheritedVarRow key={key} varKey={key} value={value} />
            ))}
          {Object.entries(vars).map(([key, value]) => (
            <CustomVarRow
              key={key}
              varKey={key}
              value={value}
              isOverride={key in appVars}
              onChange={setVar}
              onRename={renameVar}
              onRemove={removeVar}
            />
          ))}
        </div>
      )}

      {savingKey === 'env' && <p className="text-xs text-muted-foreground">Saving…</p>}
    </>
  );
}

function VarRow({
  name,
  checked,
  inherited,
  onToggle,
}: {
  name: string;
  checked: boolean;
  inherited: boolean;
  onToggle: (name: string, on: boolean) => void;
}) {
  return (
    <div className={cn('flex items-center justify-between px-3 py-1.5 gap-3', checked && 'bg-accent/30')}>
      <span className="font-mono text-xs truncate">{name}</span>
      <div className="flex items-center gap-2 shrink-0">
        {inherited && <span className="text-xs text-muted-foreground">app</span>}
        <Checkbox checked={checked} disabled={inherited} onCheckedChange={(on) => onToggle(name, !!on)} />
      </div>
    </div>
  );
}

function InheritedVarRow({ varKey, value }: { varKey: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 opacity-50">
      <span className="font-mono text-xs w-36 shrink-0 truncate">{varKey}</span>
      <span className="text-muted-foreground text-xs">=</span>
      <span className="font-mono text-xs flex-1 truncate text-muted-foreground">{value}</span>
      <span className="text-xs text-muted-foreground shrink-0">app</span>
    </div>
  );
}
