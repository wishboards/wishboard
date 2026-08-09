import React, { useState, useMemo, useEffect, useCallback } from 'react';

const getSortIcon = (ruleSort: { key: string; dir: 'asc' | 'desc' }, key: string) => {
  if (ruleSort.key !== key) return '';
  return ruleSort.dir === 'asc' ? '▲' : '▼';
};

interface Rule {
  id?: string;
  rule_type: string;
  trigger_attribute: string;
  trigger_value: string;
  target_attribute: string;
  target_value: string;
  context_attribute?: string;
  context_value?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface MatchingRulesSectionProps {
  authHeader: Record<string, string>;
  setMessage: (msg: string | null) => void;
  setError: (err: string | null) => void;
  refreshCounter: number;
}

interface MatchingRulesTableProps {
  filteredRules: Rule[];
  ruleSort: { key: string; dir: 'asc' | 'desc' };
  handleRuleSort: (key: string) => void;
  editRule: (rule: Rule) => void;
  deleteRule: (id?: string) => void;
}

function MatchingRulesTable({
  filteredRules,
  ruleSort,
  handleRuleSort,
  editRule,
  deleteRule,
}: Readonly<MatchingRulesTableProps>) {
  return (
    <div
      style={{
        overflowX: 'auto',
        marginBottom: '24px',
        background: '#1c1c1c',
        borderRadius: '8px',
        border: '1px solid #333',
      }}
    >
      <table
        className="responsive-table"
        style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', color: '#e0e0e0' }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid #444', backgroundColor: '#2a2a2a' }}>
            <th
              style={{ padding: '12px', cursor: 'pointer' }}
              onClick={() => handleRuleSort('rule_type')}
            >
              Type {getSortIcon(ruleSort, 'rule_type')}
            </th>
            <th
              style={{ padding: '12px', cursor: 'pointer' }}
              onClick={() => handleRuleSort('trigger_attribute')}
            >
              Trigger {getSortIcon(ruleSort, 'trigger_attribute')}
            </th>
            <th
              style={{ padding: '12px', cursor: 'pointer' }}
              onClick={() => handleRuleSort('context_attribute')}
            >
              Context {getSortIcon(ruleSort, 'context_attribute')}
            </th>
            <th
              style={{ padding: '12px', cursor: 'pointer' }}
              onClick={() => handleRuleSort('target_attribute')}
            >
              Target {getSortIcon(ruleSort, 'target_attribute')}
            </th>
            <th style={{ padding: '12px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredRules.map((rule) => (
            <tr key={rule.id} style={{ borderBottom: '1px solid #333' }}>
              <td data-label="Type" style={{ padding: '12px' }}>
                <strong>{rule.rule_type}</strong>
              </td>
              <td data-label="Trigger" style={{ padding: '12px' }}>
                {rule.trigger_attribute} = {rule.trigger_value}
              </td>
              <td data-label="Context" style={{ padding: '12px' }}>
                {rule.context_attribute ? (
                  `${rule.context_attribute} = ${rule.context_value}`
                ) : (
                  <span style={{ color: '#777' }}>-</span>
                )}
              </td>
              <td data-label="Target" style={{ padding: '12px' }}>
                {rule.target_attribute} = {rule.target_value}
              </td>
              <td data-label="Actions" style={{ padding: '12px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{
                    padding: '4px 8px',
                    fontSize: '0.8rem',
                    minWidth: 'auto',
                    marginRight: '4px',
                  }}
                  onClick={() => editRule(rule)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 'auto' }}
                  onClick={() => deleteRule(rule.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {filteredRules.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#888' }}>
                No matching rules found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

interface MatchingRuleFormProps {
  editingRuleId: string | null;
  newRule: Rule;
  setNewRule: (rule: Rule) => void;
  saveRule: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  cancelEdit: () => void;
}

function MatchingRuleForm({
  editingRuleId,
  newRule,
  setNewRule,
  saveRule,
  cancelEdit,
}: Readonly<MatchingRuleFormProps>) {
  return (
    <form
      id="rule-form"
      className="form-card"
      onSubmit={saveRule}
      style={{ marginTop: '24px', border: editingRuleId ? '2px solid #555' : 'none' }}
    >
      <h3>{editingRuleId ? 'Edit Rule' : 'Add New Rule'}</h3>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <label>
          Rule Type{' '}
          <select
            value={newRule.rule_type}
            onChange={(e) => setNewRule({ ...newRule, rule_type: e.target.value })}
          >
            <option value="expansion">Expansion (Synonyms)</option>
            <option value="cross_match">Cross-Match (Symmetrical)</option>
            <option value="enrichment">Enrichment (Implicit Attribute)</option>
            <option value="acceptance">Acceptance (Blank Override)</option>
          </select>
        </label>
        <label>
          Trigger Attribute{' '}
          <select
            value={newRule.trigger_attribute}
            onChange={(e) => setNewRule({ ...newRule, trigger_attribute: e.target.value })}
          >
            <option value="role">Role</option>
            <option value="gender">Gender</option>
            <option value="orientation">Orientation</option>
          </select>
        </label>
        <label>
          Target Attribute{' '}
          <select
            value={newRule.target_attribute}
            onChange={(e) => setNewRule({ ...newRule, target_attribute: e.target.value })}
          >
            <option value="role">Role</option>
            <option value="gender">Gender</option>
            <option value="orientation">Orientation</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <label style={{ flex: 1 }}>
          Trigger Value (e.g. handler){' '}
          <input
            required
            value={newRule.trigger_value}
            onChange={(e) => setNewRule({ ...newRule, trigger_value: e.target.value })}
          />
        </label>
        <label style={{ flex: 1 }}>
          Target Value (e.g. pet, pup){' '}
          <input
            required
            value={newRule.target_value}
            onChange={(e) => setNewRule({ ...newRule, target_value: e.target.value })}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <label style={{ flex: 1 }}>
          Context Attribute (Optional){' '}
          <select
            value={newRule.context_attribute}
            onChange={(e) => setNewRule({ ...newRule, context_attribute: e.target.value })}
          >
            <option value="">None</option>
            <option value="role">Role</option>
            <option value="gender">Gender</option>
            <option value="orientation">Orientation</option>
          </select>
        </label>
        <label style={{ flex: 1 }}>
          Context Value (Optional){' '}
          <input
            value={newRule.context_value}
            onChange={(e) => setNewRule({ ...newRule, context_value: e.target.value })}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit">{editingRuleId ? 'Save Changes' : 'Add Rule'}</button>
        {editingRuleId && (
          <button type="button" className="secondary-button" onClick={cancelEdit}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function MatchingRulesSection({
  authHeader,
  setMessage,
  setError,
  refreshCounter,
}: Readonly<MatchingRulesSectionProps>) {
  const [rules, setRules] = useState<Array<Rule>>([]);
  const [ruleFilter, setRuleFilter] = useState('');
  const [ruleSort, setRuleSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'created_at',
    dir: 'desc',
  });
  const emptyRule: Rule = {
    rule_type: 'expansion',
    trigger_attribute: 'role',
    trigger_value: '',
    target_attribute: 'role',
    target_value: '',
    context_attribute: '',
    context_value: '',
  };
  const [newRule, setNewRule] = useState(emptyRule);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setError(null);
    const response = await fetch('/api/rules', { headers: authHeader });
    if (response.ok) setRules(await response.json());
  }, [authHeader, setError]);

  useEffect(() => {
    loadRules();
  }, [refreshCounter, loadRules]);

  const filteredRules = useMemo(() => {
    return rules
      .filter(
        (r) =>
          !ruleFilter ||
          Object.values(r).some((v) => String(v).toLowerCase().includes(ruleFilter.toLowerCase()))
      )
      .sort((a, b) => {
        const aVal = (a[ruleSort.key] ?? '') as string;
        const bVal = (b[ruleSort.key] ?? '') as string;
        if (aVal === bVal) return 0;
        const cmp = aVal > bVal ? 1 : -1;
        return ruleSort.dir === 'asc' ? cmp : -cmp;
      });
  }, [rules, ruleFilter, ruleSort]);

  const handleRuleSort = (key: string) => {
    if (ruleSort.key === key) {
      setRuleSort({ key, dir: ruleSort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setRuleSort({ key, dir: 'asc' });
    }
  };

  const deleteRule = async (id?: string) => {
    if (!id) return;
    if (!globalThis.confirm('Are you sure you want to delete this rule?')) return;
    setMessage(null);
    setError(null);
    const response = await fetch(`/api/rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    if (!response.ok) {
      setError('Failed to delete rule.');
      return;
    }
    setMessage(`Deleted rule ${id}`);
    loadRules();
  };

  const editRule = (rule: Rule) => {
    setEditingRuleId(rule.id ?? null);
    setNewRule({
      rule_type: rule.rule_type,
      trigger_attribute: rule.trigger_attribute,
      trigger_value: rule.trigger_value,
      target_attribute: rule.target_attribute,
      target_value: rule.target_value,
      context_attribute: rule.context_attribute || '',
      context_value: rule.context_value || '',
    });
    // scroll to form
    const form = document.getElementById('rule-form');
    if (form) form.scrollIntoView({ behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingRuleId(null);
    setNewRule(emptyRule);
  };

  const saveRule = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const method = editingRuleId ? 'PUT' : 'POST';
    const url = editingRuleId ? `/api/rules/${encodeURIComponent(editingRuleId)}` : '/api/rules';

    const response = await fetch(url, {
      method,
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(newRule),
    });
    if (!response.ok) {
      setError(`Failed to ${editingRuleId ? 'update' : 'create'} rule.`);
      return;
    }
    setMessage(`Rule ${editingRuleId ? 'updated' : 'created'} successfully.`);
    setNewRule(emptyRule);
    setEditingRuleId(null);
    loadRules();
  };

  return (
    <section>
      <h2>Matching Rules</h2>
      <p>
        Define rules for the matchmaking engine. Add expansible matches (e.g. pet -&gt; pup, kitten)
        or cross-matches (e.g. handler &lt;-&gt; pet).
      </p>
      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          placeholder="Filter rules..."
          value={ruleFilter}
          onChange={(e) => setRuleFilter(e.target.value)}
          className="base-input"
          style={{ padding: '8px', width: '100%', maxWidth: '300px' }}
        />
      </div>
      <MatchingRulesTable
        filteredRules={filteredRules}
        ruleSort={ruleSort}
        handleRuleSort={handleRuleSort}
        editRule={editRule}
        deleteRule={deleteRule}
      />
      <MatchingRuleForm
        editingRuleId={editingRuleId}
        newRule={newRule}
        setNewRule={setNewRule}
        saveRule={saveRule}
        cancelEdit={cancelEdit}
      />
    </section>
  );
}
