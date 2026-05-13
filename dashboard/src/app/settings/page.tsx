'use client';

import { useEffect, useState } from 'react';

interface SettingsShape {
  cosine_floor?: number;
  cosine_margin?: number;
  self_grade_floor?: number;
  hard_floor_top1_cosine?: number;
  classification_conf_floor?: number;
  n8n_webhook_url?: string;
  n8n_callback_secret?: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsShape | null>(null);
  const [draft, setDraft] = useState<SettingsShape>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setSettings(d.settings);
          setDraft(d.settings);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  const save = async (patch: Partial<SettingsShape>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (j.error) setError(j.error);
      else {
        setSettings({ ...(settings || {}), ...patch });
        setSavedAt(Date.now());
      }
    } finally {
      setSaving(false);
    }
  };

  if (error)
    return (
      <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded text-sm">
        {error}
      </div>
    );
  if (!settings)
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        Loading…
      </div>
    );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Confidence-gate thresholds (live: the next ticket your n8n workflow processes will read these).
        </p>
      </div>

      <Card title="Confidence gate">
        <Slider
          label="L1 cosine floor"
          hint="Minimum top-1 retrieval similarity to consider auto-sending. Higher = more strict, fewer auto-sends."
          min={0.4}
          max={0.95}
          step={0.01}
          value={draft.cosine_floor ?? 0.78}
          onChange={(v) => setDraft({ ...draft, cosine_floor: v })}
          onCommit={(v) => save({ cosine_floor: v })}
        />
        <Slider
          label="L1 cosine margin"
          hint="Required gap between top-1 and top-2 chunks. Higher = retrieval must be unambiguous."
          min={0}
          max={0.2}
          step={0.01}
          value={draft.cosine_margin ?? 0.05}
          onChange={(v) => setDraft({ ...draft, cosine_margin: v })}
          onCommit={(v) => save({ cosine_margin: v })}
        />
        <Slider
          label="L2 self-grade floor"
          hint="min(grounded, directly_answers) must be ≥ this. Higher = drafts must score better to auto-send."
          min={1}
          max={5}
          step={1}
          value={draft.self_grade_floor ?? 4}
          onChange={(v) => setDraft({ ...draft, self_grade_floor: v })}
          onCommit={(v) => save({ self_grade_floor: v })}
        />
        <Slider
          label="Hard floor (cannot_answer below)"
          hint="If top-1 cosine is below this, short-circuit to cannot_answer (don't bother drafting)."
          min={0.2}
          max={0.7}
          step={0.01}
          value={draft.hard_floor_top1_cosine ?? 0.5}
          onChange={(v) => setDraft({ ...draft, hard_floor_top1_cosine: v })}
          onCommit={(v) => save({ hard_floor_top1_cosine: v })}
        />
      </Card>

      <Card title="n8n integration">
        <Text
          label="Webhook URL"
          hint="Cloudflare-tunneled URL of the respond-ticket workflow on the Mac Mini n8n instance."
          value={draft.n8n_webhook_url ?? ''}
          onChange={(v) => setDraft({ ...draft, n8n_webhook_url: v })}
          onCommit={(v) => save({ n8n_webhook_url: v })}
        />
        <Text
          label="Callback shared secret"
          hint="n8n must send this in x-n8n-token to be accepted by /api/webhook/n8n-callback."
          value={draft.n8n_callback_secret ?? ''}
          onChange={(v) => setDraft({ ...draft, n8n_callback_secret: v })}
          onCommit={(v) => save({ n8n_callback_secret: v })}
          monospace
        />
      </Card>

      <div className="text-xs text-gray-500 h-4">
        {saving ? 'Saving…' : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}.` : ''}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-sm font-medium text-gray-900">{label}</label>
        <span className="text-sm font-mono text-gray-700">
          {step >= 1 ? value : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={() => onCommit(value)}
        onTouchEnd={() => onCommit(value)}
        className="w-full"
      />
      <p className="text-xs text-gray-500 mt-1">{hint}</p>
    </div>
  );
}

function Text({
  label,
  hint,
  value,
  onChange,
  onCommit,
  monospace = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  monospace?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-900 block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
        className={`w-full border border-gray-300 rounded px-3 py-1.5 text-sm ${monospace ? 'font-mono' : ''}`}
      />
      <p className="text-xs text-gray-500 mt-1">{hint}</p>
    </div>
  );
}
