export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;
  type: string;
  entityType: string;
  entityId: string;
  meta: Record<string, unknown>;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

/** Keeps events in memory. Used by tests and by the development runner. */
export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  async write(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}
