import { beforeEach, describe, expect, it } from 'vitest';
import type { Team, User } from '@nonlinear/shared';
import { createMemoryStorage } from '../memory.js';
import { SyncBus, type Ctx } from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';
import { AuthService } from './auth.js';
import { IssueService } from './issues.js';
import { CsvService, parseCsv } from './importer.js';

describe('parseCsv', () => {
  it('parses plain rows with CRLF and trailing newline', () => {
    expect(parseCsv('a,b,c\r\n1,2,3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('parses quoted fields containing commas', () => {
    expect(parseCsv('"a,b",c\nx,"y,z"')).toEqual([
      ['a,b', 'c'],
      ['x', 'y,z'],
    ]);
  });

  it('parses escaped quotes inside quoted fields', () => {
    expect(parseCsv('"say ""hi"" now",b')).toEqual([['say "hi" now', 'b']]);
  });

  it('parses newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b\r\n"crlf\r\ninside",d\n')).toEqual([
      ['line1\nline2', 'b'],
      ['crlf\r\ninside', 'd'],
    ]);
  });

  it('handles empty fields and empty input', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('CsvService', () => {
  let ctx: Ctx;
  let issues: IssueService;
  let csv: CsvService;
  let admin: User;
  let member: User;
  let team: Team;

  beforeEach(async () => {
    const storage = createMemoryStorage();
    const bus = new SyncBus(storage.syncLog);
    ctx = { storage, bus };
    const auth = new AuthService(ctx);
    admin = (
      await auth.register({
        email: 'ada@example.com',
        password: 'hunter2hunter2',
        name: 'Ada Lovelace',
        workspaceName: 'Acme',
      })
    ).user;
    member = (
      await auth.register({
        email: 'grace@example.com',
        password: 'hunter2hunter2',
        name: 'Grace Hopper',
      })
    ).user;
    team = (await storage.teams.all())[0]!;
    issues = new IssueService(ctx);
    csv = new CsvService(ctx, issues);
  });

  it('imports a happy-path CSV with label auto-creation and Jira priority names', async () => {
    const text = [
      'Title,Description,Status,Priority,Labels,Assignee,Estimate,Due Date',
      '"Fix login, urgently",Broken auth,in progress,Highest,Bug; Backend,grace@example.com,2.5,2026-01-15',
      'Polish docs,,Done,Lowest,"Bug,Docs",Ada Lovelace,,',
      '',
    ].join('\r\n');

    const result = await csv.importIssues(admin.id, team.id, text);
    expect(result).toEqual({ created: 2, skipped: 0, errors: [] });

    const all = await ctx.storage.issues.byTeam(team.id);
    expect(all).toHaveLength(2);
    const first = all.find((i) => i.title === 'Fix login, urgently')!;
    const second = all.find((i) => i.title === 'Polish docs')!;

    // Status matched case-insensitively against team workflow states.
    const states = await ctx.storage.workflowStates.all();
    const inProgress = states.find((s) => s.teamId === team.id && s.name === 'In Progress')!;
    const done = states.find((s) => s.teamId === team.id && s.name === 'Done')!;
    expect(first.stateId).toBe(inProgress.id);
    expect(second.stateId).toBe(done.id);

    // Jira priority names.
    expect(first.priority).toBe(1);
    expect(second.priority).toBe(4);

    // Labels auto-created once as team labels with the fixed color.
    const labels = await ctx.storage.labels.all();
    const names = labels.map((l) => l.name).sort();
    expect(names).toEqual(['Backend', 'Bug', 'Docs']);
    for (const label of labels) {
      expect(label.teamId).toBe(team.id);
      expect(label.color).toBe('#95a2b3');
    }
    const bug = labels.find((l) => l.name === 'Bug')!;
    expect(first.labelIds).toContain(bug.id);
    expect(second.labelIds).toContain(bug.id);
    expect(second.labelIds).toHaveLength(2);

    // Assignee by email and by case-insensitive name.
    expect(first.assigneeId).toBe(member.id);
    expect(second.assigneeId).toBe(admin.id);

    expect(first.estimate).toBe(2.5);
    expect(first.dueDate).toBe(new Date(Date.parse('2026-01-15')).toISOString());
    expect(second.estimate).toBeNull();
    expect(second.dueDate).toBeNull();
  });

  it('reuses existing labels case-insensitively instead of creating duplicates', async () => {
    const before = (await ctx.storage.labels.all()).length;
    await csv.importIssues(admin.id, team.id, 'Title,Labels\nA,Bug\nB,bug');
    const labels = await ctx.storage.labels.all();
    expect(labels.length).toBe(before + 1);
  });

  it('skips empty-title rows and falls back on unknown values', async () => {
    const text = [
      'Summary,State,Priority,Assignee,Estimate,Due',
      'Real issue,No Such State,banana,nobody@nowhere.dev,abc,not-a-date',
      ',Done,1,,,',
      '   ,Done,1,,,',
    ].join('\n');

    const result = await csv.importIssues(admin.id, team.id, text);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual([]);

    const issue = (await ctx.storage.issues.byTeam(team.id))[0]!;
    const states = await ctx.storage.workflowStates.all();
    const backlog = states.find((s) => s.teamId === team.id && s.name === 'Backlog')!;
    expect(issue.stateId).toBe(backlog.id); // unknown status -> IssueService default
    expect(issue.priority).toBe(0); // unknown priority name -> default
    expect(issue.assigneeId).toBeNull();
    expect(issue.estimate).toBeNull();
    expect(issue.dueDate).toBeNull();
  });

  it('collects per-row errors without aborting the import', async () => {
    // A team with no workflow states makes IssueService.create throw per row.
    const now = nowIso();
    const bare: Team = {
      id: newId(),
      name: 'Bare',
      key: 'BAR',
      description: null,
      icon: null,
      color: '#000000',
      private: false,
      timezone: 'UTC',
      cyclesEnabled: false,
      cycleDurationWeeks: 2,
      triageEnabled: false,
      slaUrgentHours: null,
      slaHighHours: null,
      estimateScale: 'exponential',
      intakeEnabled: false,
      intakeToken: null,
      issueCounter: 0,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.storage.teams.insert(bare);

    const result = await csv.importIssues(admin.id, bare.id, 'Title\nFirst\n\nSecond\n');
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1); // the blank line
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^row 2: /);
    expect(result.errors[1]).toMatch(/^row 4: /);
  });

  it('rejects CSVs without a title column or without a header', async () => {
    await expect(csv.importIssues(admin.id, team.id, 'Name,Status\nA,Done')).rejects.toThrow(
      /Title/,
    );
    await expect(csv.importIssues(admin.id, team.id, '')).rejects.toThrow(/header/i);
    await expect(csv.importIssues(admin.id, 'nope', 'Title\nA')).rejects.toThrow(/not found/i);
  });

  it('exports issues and round-trips through parseCsv and importIssues', async () => {
    const imported = await csv.importIssues(
      admin.id,
      team.id,
      [
        'Title,Description,Status,Priority,Labels,Assignee,Estimate,DueDate',
        '"Comma, and ""quote""","Line one\nline two",In Progress,Urgent,Bug; Backend,grace@example.com,3,2026-02-01',
        'Plain one,,Done,None,,,,',
        '',
      ].join('\r\n'),
    );
    expect(imported.errors).toEqual([]);

    const exported = await csv.exportIssues(team.id);
    const rows = parseCsv(exported);
    expect(rows[0]).toEqual([
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
    ]);
    expect(rows).toHaveLength(3);

    const fancy = rows.find((r) => r[0] === 'Comma, and "quote"')!;
    expect(fancy[1]).toBe('Line one\nline two');
    expect(fancy[2]).toBe('In Progress');
    expect(fancy[3]).toBe('Urgent');
    expect(fancy[4]).toBe('Bug; Backend');
    expect(fancy[5]).toBe('Grace Hopper');
    expect(fancy[6]).toBe('3');
    expect(fancy[7]).toBe(new Date(Date.parse('2026-02-01')).toISOString());
    expect(fancy[8]).toBe(`${team.key}-1`);

    const plain = rows.find((r) => r[0] === 'Plain one')!;
    expect(plain[3]).toBe('None');
    expect(plain[4]).toBe('');
    expect(plain[5]).toBe('');

    // Re-import the export: values survive the round trip.
    const again = await csv.importIssues(admin.id, team.id, exported);
    expect(again).toEqual({ created: 2, skipped: 0, errors: [] });
    const clone = (await ctx.storage.issues.byTeam(team.id)).find(
      (i) => i.title === 'Comma, and "quote"' && i.number > 2,
    )!;
    expect(clone.description).toBe('Line one\nline two');
    expect(clone.priority).toBe(1);
    expect(clone.assigneeId).toBe(member.id);
    expect(clone.estimate).toBe(3);
  });
});
