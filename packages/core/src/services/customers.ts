import type {
  CreateCustomerInput,
  CreateCustomerRequestInput,
  Customer,
  CustomerRequest,
  UpdateCustomerInput,
  UpdateCustomerRequestInput,
} from '@nonlinear/shared';
import {
  DomainError,
  created,
  deleted,
  notFound,
  updated,
  type Ctx,
  type DeltaInput,
} from '../domain.js';
import { newId } from '../util/ids.js';
import { nowIso } from '../util/time.js';

/** Normalize an email domain: lowercase, no leading '@', null when blank. */
function normalizeDomain(domain: string | null | undefined): string | null {
  if (domain === undefined || domain === null) return null;
  const cleaned = domain.trim().replace(/^@+/, '').toLowerCase();
  return cleaned || null;
}

export class CustomerService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateCustomerInput): Promise<Customer> {
    const { storage, bus } = this.ctx;
    const name = input.name.trim();
    if (!name) throw new DomainError('invalid_name', 'Customer name is required');
    for (const existing of await storage.customers.all()) {
      if (existing.name.toLowerCase() === name.toLowerCase()) {
        throw new DomainError('customer_exists', 'A customer with this name already exists', 409);
      }
    }
    const now = nowIso();
    const customer: Customer = {
      id: newId(),
      name,
      tier: input.tier ?? null,
      revenue: input.revenue ?? null,
      domain: normalizeDomain(input.domain),
      createdAt: now,
      updatedAt: now,
    };
    await storage.customers.insert(customer);
    await bus.publish([created('customer', customer)]);
    return customer;
  }

  async update(customerId: string, input: UpdateCustomerInput): Promise<Customer> {
    const { storage, bus } = this.ctx;
    const customer = await storage.customers.get(customerId);
    if (!customer) throw notFound('Customer');
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new DomainError('invalid_name', 'Customer name is required');
      for (const existing of await storage.customers.all()) {
        if (existing.id !== customerId && existing.name.toLowerCase() === name.toLowerCase()) {
          throw new DomainError('customer_exists', 'A customer with this name already exists', 409);
        }
      }
      customer.name = name;
    }
    if (input.tier !== undefined) customer.tier = input.tier;
    if (input.revenue !== undefined) customer.revenue = input.revenue;
    if (input.domain !== undefined) customer.domain = normalizeDomain(input.domain);
    customer.updatedAt = nowIso();
    await storage.customers.update(customer);
    await bus.publish([updated('customer', customer)]);
    return customer;
  }

  async remove(customerId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const customer = await storage.customers.get(customerId);
    if (!customer) throw notFound('Customer');
    const deltas: DeltaInput[] = [];
    for (const request of await storage.customerRequests.all()) {
      if (request.customerId === customerId) {
        await storage.customerRequests.delete(request.id);
        deltas.push(deleted('customerRequest', request.id));
      }
    }
    await storage.customers.delete(customerId);
    deltas.push(deleted('customer', customerId));
    await bus.publish(deltas);
  }

  /** Find the customer whose domain matches the part after '@', case-insensitive. */
  async findByEmailDomain(email: string): Promise<Customer | null> {
    const at = email.lastIndexOf('@');
    if (at < 0) return null;
    const domain = email
      .slice(at + 1)
      .trim()
      .toLowerCase();
    if (!domain) return null;
    for (const customer of await this.ctx.storage.customers.all()) {
      if (customer.domain !== null && customer.domain === domain) return customer;
    }
    return null;
  }
}

export class CustomerRequestService {
  constructor(private ctx: Ctx) {}

  async create(input: CreateCustomerRequestInput): Promise<CustomerRequest> {
    const { storage, bus } = this.ctx;
    if (!(await storage.customers.get(input.customerId))) throw notFound('Customer');
    if (input.issueId && !(await storage.issues.get(input.issueId))) throw notFound('Issue');
    if (input.projectId && !(await storage.projects.get(input.projectId)))
      throw notFound('Project');
    const body = input.body.trim();
    if (!body) throw new DomainError('invalid_body', 'Request body is required');
    const now = nowIso();
    const request: CustomerRequest = {
      id: newId(),
      customerId: input.customerId,
      issueId: input.issueId ?? null,
      projectId: input.projectId ?? null,
      body,
      source: input.source ?? 'manual',
      createdAt: now,
      updatedAt: now,
    };
    await storage.customerRequests.insert(request);
    await bus.publish([created('customerRequest', request)]);
    return request;
  }

  async update(requestId: string, input: UpdateCustomerRequestInput): Promise<CustomerRequest> {
    const { storage, bus } = this.ctx;
    const request = await storage.customerRequests.get(requestId);
    if (!request) throw notFound('CustomerRequest');
    if (input.body !== undefined) {
      const body = input.body.trim();
      if (!body) throw new DomainError('invalid_body', 'Request body is required');
      request.body = body;
    }
    if (input.issueId !== undefined) {
      if (input.issueId && !(await storage.issues.get(input.issueId))) throw notFound('Issue');
      request.issueId = input.issueId ?? null;
    }
    if (input.projectId !== undefined) {
      if (input.projectId && !(await storage.projects.get(input.projectId))) {
        throw notFound('Project');
      }
      request.projectId = input.projectId ?? null;
    }
    request.updatedAt = nowIso();
    await storage.customerRequests.update(request);
    await bus.publish([updated('customerRequest', request)]);
    return request;
  }

  async remove(requestId: string): Promise<void> {
    const { storage, bus } = this.ctx;
    const request = await storage.customerRequests.get(requestId);
    if (!request) throw notFound('CustomerRequest');
    await storage.customerRequests.delete(requestId);
    await bus.publish([deleted('customerRequest', requestId)]);
  }

  /**
   * Detach all requests pointing at an issue (set issueId=null) and return the
   * update deltas WITHOUT publishing, so the caller can fold them into its own
   * cascade (e.g. issue deletion).
   */
  async detachIssue(issueId: string): Promise<DeltaInput[]> {
    const { storage } = this.ctx;
    const deltas: DeltaInput[] = [];
    const now = nowIso();
    for (const request of await storage.customerRequests.all()) {
      if (request.issueId === issueId) {
        request.issueId = null;
        request.updatedAt = now;
        await storage.customerRequests.update(request);
        deltas.push(updated('customerRequest', request));
      }
    }
    return deltas;
  }
}
