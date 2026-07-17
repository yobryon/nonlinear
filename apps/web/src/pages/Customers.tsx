import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Customer } from '@nonlinear/shared';
import { api } from '../api.js';
import { issueKey, relativeTime, useStore } from '../store.js';
import { anchorFromEvent, toastError } from '../ui.js';
import { CloseIcon, LinkIcon, PlusIcon, TeamIcon, TrashIcon } from '../icons.js';
import { IssuePicker, usePicker } from '../pickers.js';
import { Markdown } from '../markdown.js';

function formatRevenue(revenue: number): string {
  if (revenue >= 1_000_000) {
    const m = revenue / 1_000_000;
    return `$${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (revenue >= 1_000) return `$${Math.round(revenue / 1_000)}k`;
  return `$${revenue}`;
}

const SOURCE_LABELS: Record<string, string> = { manual: 'Manual', intake: 'Intake' };

/* ---------- /customers ---------- */

export function CustomersPage() {
  const customers = useStore((s) => s.customers);
  const customerRequests = useStore((s) => s.customerRequests);
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const rows = useMemo(
    () => Object.values(customers).sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  );

  const requestCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of Object.values(customerRequests)) {
      counts[r.customerId] = (counts[r.customerId] ?? 0) + 1;
    }
    return counts;
  }, [customerRequests]);

  const create = () => {
    if (!name.trim()) return;
    void api
      .createCustomer({ name: name.trim() })
      .then((customer) => {
        useStore.getState().putEntity('customer', customer);
        setName('');
        navigate(`/customer/${customer.id}`);
      })
      .catch(toastError);
  };

  return (
    <>
      <div className="topbar">
        <div className="title">
          <TeamIcon size={15} style={{ color: 'var(--text-2)' }} />
          Customers
        </div>
        <span className="spacer" />
        <input
          className="input"
          style={{ width: 200, height: 26 }}
          placeholder="New customer…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
          }}
        />
        <button className="btn primary" disabled={!name.trim()} onClick={create}>
          <PlusIcon size={13} /> Create
        </button>
      </div>
      <div className="content">
        {rows.length === 0 && (
          <div className="empty-state">
            <TeamIcon size={26} style={{ color: 'var(--text-4)' }} />
            <h3>No customers</h3>
            <p>
              Customers collect requests from your users so you can link them to issues and see who
              is asking for what. Create your first customer to start tracking requests.
            </p>
          </div>
        )}
        {rows.map((customer) => {
          const count = requestCounts[customer.id] ?? 0;
          return (
            <div
              key={customer.id}
              className="project-row"
              onClick={() => navigate(`/customer/${customer.id}`)}
            >
              <span className="name">{customer.name}</span>
              {customer.tier && <span className="chip">{customer.tier}</span>}
              {customer.revenue !== null && (
                <span className="dim">{formatRevenue(customer.revenue)}</span>
              )}
              <span className="grow" />
              <span className="dim">
                {count} request{count === 1 ? '' : 's'}
              </span>
              {customer.domain && (
                <span className="dim" style={{ width: 150, textAlign: 'right' }}>
                  {customer.domain}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- /customer/:customerId ---------- */

export function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const customers = useStore((s) => s.customers);
  const customer = customerId ? customers[customerId] : null;
  if (!customer) {
    return (
      <div className="empty-state">
        <h3>Customer not found</h3>
      </div>
    );
  }
  return <CustomerDetail key={customer.id} customer={customer} />;
}

function Field({
  label,
  defaultValue,
  placeholder,
  type = 'text',
  onSave,
}: {
  label: string;
  defaultValue: string;
  placeholder?: string;
  type?: string;
  onSave: (value: string) => void;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        className="input"
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

function CustomerDetail({ customer }: { customer: Customer }) {
  const customerRequests = useStore((s) => s.customerRequests);
  const issues = useStore((s) => s.issues);
  const teams = useStore((s) => s.teams);
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [linkIssueId, setLinkIssueId] = useState<string | null>(null);
  const issuePicker = usePicker();

  const requests = useMemo(
    () =>
      Object.values(customerRequests)
        .filter((r) => r.customerId === customer.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [customerRequests, customer.id],
  );

  const patch = (input: Record<string, unknown>) => {
    void api
      .updateCustomer(customer.id, input)
      .then((c) => useStore.getState().putEntity('customer', c))
      .catch(toastError);
  };

  const removeCustomer = () => {
    if (!window.confirm(`Delete ${customer.name}? This also deletes all of their requests.`)) {
      return;
    }
    void api
      .deleteCustomer(customer.id)
      .then(() => {
        const state = useStore.getState();
        const customers = { ...state.customers };
        delete customers[customer.id];
        const remaining = Object.fromEntries(
          Object.entries(state.customerRequests).filter(([, r]) => r.customerId !== customer.id),
        );
        useStore.setState({ customers, customerRequests: remaining });
        navigate('/customers');
      })
      .catch(toastError);
  };

  const addRequest = () => {
    if (!body.trim()) return;
    void api
      .createCustomerRequest({
        customerId: customer.id,
        body: body.trim(),
        issueId: linkIssueId,
        source: 'manual',
      })
      .then((request) => {
        useStore.getState().putEntity('customerRequest', request);
        setBody('');
        setLinkIssueId(null);
      })
      .catch(toastError);
  };

  const linkedComposerIssue = linkIssueId ? issues[linkIssueId] : null;

  return (
    <>
      <div className="topbar">
        <div className="title">
          <Link to="/customers" className="crumb">
            Customers
          </Link>
          <span className="crumb">›</span>
          {customer.name}
          {customer.tier && <span className="chip">{customer.tier}</span>}
        </div>
        <span className="spacer" />
      </div>
      <div className="content">
        <div style={{ padding: '24px 24px 80px', maxWidth: 680 }}>
          <div className="settings-section">
            <h2>Details</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field
                label="Name"
                defaultValue={customer.name}
                placeholder="Customer name"
                onSave={(v) => {
                  const name = v.trim();
                  if (name && name !== customer.name) patch({ name });
                }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <Field
                  label="Tier"
                  defaultValue={customer.tier ?? ''}
                  placeholder="e.g. Enterprise"
                  onSave={(v) => {
                    const tier = v.trim() || null;
                    if (tier !== customer.tier) patch({ tier });
                  }}
                />
                <Field
                  label="Revenue"
                  type="number"
                  defaultValue={customer.revenue !== null ? String(customer.revenue) : ''}
                  placeholder="Annual, in $"
                  onSave={(v) => {
                    const revenue = v.trim() === '' ? null : Number(v);
                    if (revenue !== null && !Number.isFinite(revenue)) return;
                    if (revenue !== customer.revenue) patch({ revenue });
                  }}
                />
                <Field
                  label="Domain"
                  defaultValue={customer.domain ?? ''}
                  placeholder="acme.com"
                  onSave={(v) => {
                    const domain = v.trim() || null;
                    if (domain !== customer.domain) patch({ domain });
                  }}
                />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2>
              Requests{' '}
              <span className="dim" style={{ fontWeight: 400 }}>
                {requests.length}
              </span>
            </h2>
            {requests.length === 0 && (
              <p className="muted" style={{ padding: '4px 0 10px' }}>
                No requests yet — capture what this customer asked for below.
              </p>
            )}
            {requests.map((request) => {
              const issue = request.issueId ? issues[request.issueId] : null;
              return (
                <div
                  key={request.id}
                  style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <Markdown source={request.body} />
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <span className="chip">{SOURCE_LABELS[request.source] ?? request.source}</span>
                    {issue && (
                      <>
                        <button
                          className="chip"
                          title="Open issue"
                          onClick={() => navigate(`/issue/${issueKey(issue, teams)}`)}
                        >
                          {issueKey(issue, teams)}
                          <span
                            className="dim"
                            style={{
                              maxWidth: 220,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {issue.title}
                          </span>
                        </button>
                        <button
                          className="icon-btn"
                          title="Unlink issue"
                          onClick={() => {
                            void api
                              .updateCustomerRequest(request.id, { issueId: null })
                              .then((r) => useStore.getState().putEntity('customerRequest', r))
                              .catch(toastError);
                          }}
                        >
                          <CloseIcon size={13} />
                        </button>
                      </>
                    )}
                    <span className="grow" />
                    <span className="dim">{relativeTime(request.createdAt)}</span>
                    <button
                      className="icon-btn"
                      title="Delete request"
                      onClick={() => {
                        void api
                          .deleteCustomerRequest(request.id)
                          .then(() => {
                            const next = { ...useStore.getState().customerRequests };
                            delete next[request.id];
                            useStore.setState({ customerRequests: next });
                          })
                          .catch(toastError);
                      }}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <textarea
                className="input"
                placeholder="What did the customer ask for? Markdown is supported."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="row" style={{ gap: 8 }}>
                <button className="chip" onClick={(e) => issuePicker.open(anchorFromEvent(e))}>
                  <LinkIcon size={12} />
                  {linkedComposerIssue ? issueKey(linkedComposerIssue, teams) : 'Link issue'}
                </button>
                {linkedComposerIssue && (
                  <button
                    className="icon-btn"
                    title="Clear linked issue"
                    onClick={() => setLinkIssueId(null)}
                  >
                    <CloseIcon size={13} />
                  </button>
                )}
                <span className="grow" />
                <button className="btn primary" disabled={!body.trim()} onClick={addRequest}>
                  Add request
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h2>Danger</h2>
            <div className="setting-row">
              <div className="info">
                <div className="label">Delete customer</div>
                <div className="desc">Removes this customer and all of their requests.</div>
              </div>
              <button className="btn danger" onClick={removeCustomer}>
                <TrashIcon size={13} /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {issuePicker.anchor && (
        <IssuePicker
          anchor={issuePicker.anchor}
          onClose={issuePicker.close}
          onPick={(issueId) => setLinkIssueId(issueId)}
          placeholder="Link to issue…"
        />
      )}
    </>
  );
}
