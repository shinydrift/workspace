import React, { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, ArrowClockwise, Plus } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { CustomVarRow } from '../CustomVarRow';

export function EnvTab() {
  const { env } = useSettings();
  const [allVars, setAllVars] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const vars = await window.electronAPI.env.listShellVars();
      setAllVars(vars);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const safelist = env.envSafelist;

  function toggle(name: string, on: boolean) {
    if (on) {
      env.setEnvSafelist([...safelist, name]);
    } else {
      env.setEnvSafelist(safelist.filter((n) => n !== name));
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allVars.filter((v) => !q || v.toLowerCase().includes(q));
  }, [allVars, search]);

  // selected at top, then unselected — both alphabetical (allVars is already sorted)
  const selected = filtered.filter((v) => safelist.includes(v));
  const unselected = filtered.filter((v) => !safelist.includes(v));

  const envVars = env.envVars;

  function setVar(key: string, value: string) {
    env.setEnvVars({ ...envVars, [key]: value });
  }

  function renameVar(oldKey: string, newKey: string) {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(envVars)) {
      updated[k === oldKey ? trimmed : k] = v;
    }
    env.setEnvVars(updated);
  }

  function removeVar(key: string) {
    const updated = { ...envVars };
    delete updated[key];
    env.setEnvVars(updated);
  }

  function addVar() {
    let n = 1;
    while (`VAR_${n}` in envVars) n++;
    env.setEnvVars({ ...envVars, [`VAR_${n}`]: '' });
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Select environment variables from your host shell to forward into sandbox containers. AgentOS reads your login
        shell environment (<span className="font-mono">$SHELL -l</span>) at thread start and forwards selected
        variables.
      </p>

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
          onClick={load}
          title="Refresh"
          aria-label="Refresh environment variables"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                <VarRow key={name} name={name} checked={true} onToggle={toggle} />
              ))}
              {selected.length > 0 && unselected.length > 0 && (
                <div className="px-3 py-1 bg-muted/40">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available</span>
                </div>
              )}
              {unselected.map((name) => (
                <VarRow key={name} name={name} checked={false} onToggle={toggle} />
              ))}
            </div>
          </div>
        )}
      </div>

      {safelist.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {safelist.length} variable{safelist.length !== 1 ? 's' : ''} selected
        </p>
      )}

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs font-medium">Custom Variables</p>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={addVar} title="Add variable">
          <Plus size={13} />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground -mt-1">
        Define key=value pairs injected directly into containers, independent of the host shell.
      </p>

      {Object.keys(envVars).length > 0 && (
        <div className="border border-border rounded-md divide-y divide-border">
          {Object.entries(envVars).map(([key, value]) => (
            <CustomVarRow
              key={key}
              varKey={key}
              value={value}
              onChange={setVar}
              onRename={renameVar}
              onRemove={removeVar}
            />
          ))}
        </div>
      )}
    </>
  );
}

function VarRow({
  name,
  checked,
  onToggle,
}: {
  name: string;
  checked: boolean;
  onToggle: (name: string, on: boolean) => void;
}) {
  return (
    <div className={cn('flex items-center justify-between px-3 py-1.5 gap-3', checked && 'bg-accent/30')}>
      <span className="font-mono text-xs truncate">{name}</span>
      <Checkbox checked={checked} onCheckedChange={(on) => onToggle(name, !!on)} />
    </div>
  );
}
