import type { ImportResult, Label, Priority } from '@nonlinear/shared';
import { DomainError, notFound, type Ctx } from '../domain.js';
import { IssueService } from './issues.js';
import { LabelService } from './labels.js';

/** Column keys the importer understands. */
type Column =
  'title' | 'description' | 'status' | 'priority' | 'labels' | 'assignee' | 'estimate' | 'dueDate';

/** Case-insensitive header aliases -> canonical column. */
const HEADER_ALIASES: Record<string, Column> = {
  title: 'title',
  summary: 'title',
  description: 'description',
  status: 'status',
  state: 'status',
  priority: 'priority',
  labels: 'labels',
  label: 'labels',
  tags: 'labels',
  assignee: 'assignee',
  estimate: 'estimate',
  duedate: 'dueDate',
  'due date': 'dueDate',
  due: 'dueDate',
};

/** Priority names accepted on import (includes Jira's five-level scheme). */
const PRIORITY_NAMES: Record<string, Priority> = {
  none: 0,
  'no priority': 0,
  urgent: 1,
  highest: 1,
  high: 2,
  medium: 3,
  low: 4,
  lowest: 4,
};

/** Priority number -> name used on export (round-trips through PRIORITY_NAMES). */
const PRIORITY_EXPORT_NAMES: Record<Priority, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

const EXPORT_HEADER = [
  'Title',
  'Description',
  'Status',
  'Priority',
  'Labels',
  'Assignee',
  'Estimate',
  'DueDate',
  'Identifier',
  'CreatedAt',
];

const AUTO_LABEL_COLOR = '#95a2b3';

/**
 * Parse RFC 4180 CSV: comma-separated fields, double-quote quoting, `""`
 * escapes a quote inside a quoted field, and newlines are allowed inside
 * quoted fields. Handles CRLF line endings and a trailing newline.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  // Final row unless the text ended cleanly on a newline (or was empty).
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/** Quote a value for CSV output when it contains a comma, quote, or newline. */
function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parsePriority(raw: string): Priority | undefined {
  if (!raw) return undefined;
  const named = PRIORITY_NAMES[raw.toLowerCase()];
  if (named !== undefined) return named;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= 4) return n as Priority;
  return undefined;
}

/** CSV import/export of issues. */
export class CsvService {
  private labels: LabelService;

  constructor(
    private ctx: Ctx,
    private issues: IssueService,
  ) {
    this.labels = new LabelService(ctx);
  }

  /**
   * Import issues from CSV text. The first row must be a header; columns are
   * matched case-insensitively via aliases (Title/Summary, Status/State,
   * Labels/Label/Tags, DueDate/Due Date/Due, ...). Rows with an empty title
   * are counted as skipped; rows that fail to import are collected as
   * per-row error strings without aborting the rest of the import.
   */
  async importIssues(actorId: string, teamId: string, csvText: string): Promise<ImportResult> {
    const { storage } = this.ctx;
    const team = await storage.teams.get(teamId);
    if (!team) throw notFound('Team');

    const rows = parseCsv(csvText);
    const header = rows[0];
    if (!header) throw new DomainError('invalid_csv', 'CSV is empty; a header row is required');
    const columns: Partial<Record<Column, number>> = {};
    header.forEach((name, index) => {
      const column = HEADER_ALIASES[name.trim().toLowerCase()];
      if (column !== undefined && columns[column] === undefined) columns[column] = index;
    });
    if (columns.title === undefined) {
      throw new DomainError('invalid_csv', 'CSV header must include a Title (or Summary) column');
    }

    const states = (await storage.workflowStates.all()).filter((s) => s.teamId === teamId);
    const labelByName = new Map<string, Label>();
    for (const label of await storage.labels.all()) {
      if (label.teamId === teamId || label.teamId === null) {
        labelByName.set(label.name.toLowerCase(), label);
      }
    }
    const users = await storage.users.all();

    const result: ImportResult = { created: 0, skipped: 0, errors: [] };

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]!;
      const cell = (column: Column): string => {
        const index = columns[column];
        return index === undefined ? '' : (row[index] ?? '').trim();
      };

      const title = cell('title');
      if (!title) {
        result.skipped++;
        continue;
      }

      try {
        // Status: match team workflow state by name; unknown -> service default.
        const statusRaw = cell('status');
        const state = statusRaw
          ? states.find((s) => s.name.toLowerCase() === statusRaw.toLowerCase())
          : undefined;

        const priority = parsePriority(cell('priority'));

        // Labels: split on ';' then ','; create missing ones as team labels.
        const labelIds: string[] = [];
        const labelsRaw = cell('labels');
        if (labelsRaw) {
          const names = labelsRaw
            .split(';')
            .flatMap((part) => part.split(','))
            .map((name) => name.trim())
            .filter(Boolean);
          for (const name of names) {
            let label = labelByName.get(name.toLowerCase());
            if (!label) {
              label = await this.labels.create({ teamId, name, color: AUTO_LABEL_COLOR });
              labelByName.set(label.name.toLowerCase(), label);
            }
            if (!labelIds.includes(label.id)) labelIds.push(label.id);
          }
        }

        // Assignee: exact email, then case-insensitive name/displayName.
        let assigneeId: string | null = null;
        const assigneeRaw = cell('assignee');
        if (assigneeRaw) {
          const lower = assigneeRaw.toLowerCase();
          const user =
            users.find((u) => u.email === assigneeRaw) ??
            users.find(
              (u) => u.name.toLowerCase() === lower || u.displayName.toLowerCase() === lower,
            );
          assigneeId = user?.id ?? null;
        }

        const estimateRaw = cell('estimate');
        const estimateParsed = Number.parseFloat(estimateRaw);
        const estimate = estimateRaw && !Number.isNaN(estimateParsed) ? estimateParsed : null;

        const dueRaw = cell('dueDate');
        const dueParsed = Date.parse(dueRaw);
        const dueDate =
          dueRaw && !Number.isNaN(dueParsed) ? new Date(dueParsed).toISOString() : null;

        await this.issues.create(actorId, {
          teamId,
          title,
          description: cell('description') || undefined,
          stateId: state?.id,
          priority,
          assigneeId,
          estimate,
          dueDate,
          labelIds,
        });
        result.created++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`row ${r + 1}: ${message}`);
      }
    }
    return result;
  }

  /**
   * Export a team's issues as CSV with header
   * Title,Description,Status,Priority,Labels,Assignee,Estimate,DueDate,Identifier,CreatedAt.
   */
  async exportIssues(teamId: string): Promise<string> {
    const { storage } = this.ctx;
    const team = await storage.teams.get(teamId);
    if (!team) throw notFound('Team');

    const issues = (await storage.issues.byTeam(teamId)).sort((a, b) => a.number - b.number);
    const stateById = new Map((await storage.workflowStates.all()).map((s) => [s.id, s]));
    const labelById = new Map((await storage.labels.all()).map((l) => [l.id, l]));
    const userById = new Map((await storage.users.all()).map((u) => [u.id, u]));

    const lines = [EXPORT_HEADER.map(escapeCsv).join(',')];
    for (const issue of issues) {
      const labelNames = issue.labelIds
        .map((id) => labelById.get(id)?.name)
        .filter((name): name is string => Boolean(name));
      const assignee = issue.assigneeId ? userById.get(issue.assigneeId) : undefined;
      const cells = [
        issue.title,
        issue.description,
        stateById.get(issue.stateId)?.name ?? '',
        PRIORITY_EXPORT_NAMES[issue.priority],
        labelNames.join('; '),
        assignee?.name ?? '',
        issue.estimate === null ? '' : String(issue.estimate),
        issue.dueDate ?? '',
        `${team.key}-${issue.number}`,
        issue.createdAt,
      ];
      lines.push(cells.map(escapeCsv).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }
}
