export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Confidence thresholds, prompts, and n8n webhook URL.</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-500">
        Settings view ships in Phase 5.
      </div>
    </div>
  );
}
