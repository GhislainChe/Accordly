import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { amendmentIntegration } from "./amendment-integration.mjs";

// Actual HTTP/Auth/SQL services, synthetic mailbox delivery (not a mocked OTP).
export async function signingIntegration({ api, base, a, b, aid, winner, adminSql, mailbox, check }) {
  const call = (body, cookie = "") => api(base, "/api/agreements/signing", cookie, body);
  const issuer = (body) => call(body, a.cookie);
  const slotsResult = await issuer({ operation: "list_slots", agreement_id: aid });
  check(slotsResult.status === 200, `Authorized slot listing (${slotsResult.status}/${slotsResult.body.error})`);
  const slots = slotsResult.body.slots;
  const clientSlot = slots.find((s) => s.side === "client");
  const providerSlot = slots.find((s) => s.side === "provider");
  check((await call({ operation: "list_slots", agreement_id: aid }, b.cookie)).status === 404, "Cross-tenant signer enumeration blocked");
  check((await call({ operation: "read" })).status === 401, "No party content before verification");
  async function invite(slot) {
    const result = await issuer({ operation: "invite", agreement_id: aid, slot_id: slot.slot_id, idempotency_key: randomUUID() });
    check(result.status === 200 && result.body.development_invitation, `Local invitation issuance (${result.status}/${result.body.error})`);
    return result.body.development_invitation;
  }
  let clientInvite = await invite(clientSlot);
  check((await call({ operation: "start_access", ...clientInvite, token: randomBytes(32).toString("base64url") })).status === 403, "Forged invitation rejected");
  check((await call({ operation: "start_access", ...clientInvite, agreement_id: randomUUID() })).status === 422, "Invitation scope cannot be supplied/overridden");
  const start = await call({ operation: "start_access", ...clientInvite });
  check(start.status === 200 && !start.body.code, `Challenge starts without returning OTP (${start.status}/${start.body.error})`);
  const delivery = JSON.parse(readFileSync(path.join(mailbox, `${start.body.challenge_id}.json`), "utf8"));
  const wrong = delivery.code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++) check((await call({ operation: "verify_access", ...clientInvite, challenge_id: start.body.challenge_id, code: wrong })).status === 403, "Wrong challenge code rejected and attempt persisted");
  check((await call({ operation: "verify_access", ...clientInvite, challenge_id: start.body.challenge_id, code: delivery.code })).status === 403, "Exhausted challenge rejects even correct code");
  check(adminSql(`select failed_attempts from accordly.email_challenges where id='${start.body.challenge_id}';`).trim() === "5", "Attempt counter committed despite HTTP failures");
  const expiredId = randomUUID(), expiredToken = randomBytes(32).toString("base64url");
  const expiredDigest = createHash("sha256").update(`accordly:invitation:v1:${expiredId}:${expiredToken}`).digest("hex");
  adminSql(`insert into accordly.invitations(id,organization_id,agreement_id,proposal_id,slot_id,intended_email,token_digest,issued_by,issued_at,expires_at) select '${expiredId}',organization_id,agreement_id,proposal_id,slot_id,intended_email,decode('${expiredDigest}','hex'),issued_by,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day' from accordly.invitations where id='${clientInvite.invitation_id}';`);
  check((await call({ operation: "start_access", invitation_id: expiredId, token: expiredToken })).status === 403, "Expired invitation cannot start verification");
  const predecessor = clientInvite;
  clientInvite = await invite(clientSlot);
  check((await call({ operation: "start_access", ...predecessor })).status === 403, "Reissue revokes predecessor token");
  check((await issuer({ operation: "revoke_invitation", agreement_id: aid, slot_id: clientSlot.slot_id, idempotency_key: randomUUID() })).status === 200, "Issuer can revoke pending invitation");
  check((await call({ operation: "start_access", ...clientInvite })).status === 403, "Explicitly revoked invitation is unusable");
  clientInvite = await invite(clientSlot);
  const expiredChallenge = await call({ operation: "start_access", ...clientInvite });
  check(expiredChallenge.status === 200, "Fresh challenge can follow invitation reissue");
  const expiredMail = JSON.parse(readFileSync(path.join(mailbox, `${expiredChallenge.body.challenge_id}.json`), "utf8"));
  adminSql(`update accordly.email_challenges set issued_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 second' where id='${expiredChallenge.body.challenge_id}';`);
  check((await call({ operation: "verify_access", ...clientInvite, challenge_id: expiredChallenge.body.challenge_id, code: expiredMail.code })).status === 403, "Expired challenge rejects correct code");
  async function access(invitation, auth = "") {
    const started = await call({ operation: "start_access", ...invitation }, auth);
    check(started.status === 200, `Access challenge (${started.status}/${started.body.error})`);
    const mail = JSON.parse(readFileSync(path.join(mailbox, `${started.body.challenge_id}.json`), "utf8"));
    const verified = await call({ operation: "verify_access", ...invitation, challenge_id: started.body.challenge_id, code: mail.code }, auth);
    check(verified.status === 200 && verified.headers.get("set-cookie")?.includes("HttpOnly"), `Mailbox verification sets HttpOnly cookie (${verified.status}/${verified.body.error})`);
    check(!verified.body.session_id, "Raw session does not appear in JSON");
    const session = verified.headers.get("set-cookie").match(/__Host-accordly-party=[^;]+/)[0];
    return { cookie: [auth, session].filter(Boolean).join("; "), session, challenge: started.body.challenge_id, code: mail.code };
  }
  const client = await access(clientInvite);
  check((await call({ operation: "verify_access", ...clientInvite, challenge_id: client.challenge, code: client.code })).status === 403, "Consumed invitation cannot mint another session");
  const read = await call({ operation: "read" }, client.cookie);
  check(read.status === 200 && read.body.digest === winner.body.digest && !read.body.draft, "Guest sees exact frozen content only");
  check(read.headers.get("cache-control") === "private, no-store", "Guest response is not cached");
  const clientSessionId = client.session.split("=")[1].split(".")[0];
  adminSql(`update accordly.guest_sessions set last_seen_at=clock_timestamp()-interval '31 minutes' where id='${clientSessionId}';`);
  check((await call({ operation: "read" }, client.cookie)).status === 403, "Idle-expired guest session is denied by database");
  adminSql(`update accordly.guest_sessions set last_seen_at=clock_timestamp() where id='${clientSessionId}';`);
  const providerInvite = await invite(providerSlot);
  check((await call({ operation: "start_access", ...providerInvite })).status === 403, "Provider cannot bypass live Supabase Auth through guest path");
  const provider = await access(providerInvite, a.cookie);
  check((await call({ operation: "read" }, provider.session)).status === 403, "Registered party capability cannot replace its live Auth session");
  async function proof(party) {
    const started = await call({ operation: "start_consent", proposal_id: read.body.proposal_id, digest: read.body.digest }, party.cookie);
    check(started.status === 200, `Fresh consent challenge (${started.status}/${started.body.error})`);
    const mail = JSON.parse(readFileSync(path.join(mailbox, `${started.body.challenge_id}.json`), "utf8"));
    const verified = await call({ operation: "verify_consent", challenge_id: started.body.challenge_id, code: mail.code }, party.cookie);
    check(verified.status === 200 && verified.body.proof_secret, `One-use proof issued (${verified.status}/${verified.body.error})`);
    return verified.body;
  }
  const cp = await proof(client); let pp = await proof(provider);
  const command = (p, name) => ({ operation: "initial_signature", proposal_id: read.body.proposal_id, digest: read.body.digest, proof_id: p.proof_id, proof_secret: p.proof_secret, affirmative: true, typed_name: name, consent_text: read.body.consent_text, disclosure_version: read.body.disclosure_version, idempotency_key: randomUUID() });
  const cs = command(cp, "Client"); let ps = command(pp, "Provider");
  check((await call({ ...cs, affirmative: false }, client.cookie)).status === 422, "No implicit or false consent");
  check((await call({ ...cs, digest: "00".repeat(32) }, client.cookie)).status === 409, "Stale/wrong digest rejected");
  check((await call(ps, client.cookie)).status === 403, "Proof bound to another signer/session rejected");
  const signed = await call(cs, client.cookie);
  check(signed.status === 200 && signed.body.active === false, `Partial quorum cannot activate (${signed.status}/${signed.body.error})`);
  check((await call(cs, client.cookie)).body.decision_id === signed.body.decision_id, "Identical signing retry returns committed receipt");
  check((await call({ ...cs, typed_name: "Changed" }, client.cookie)).status === 409, "Conflicting signing receipt rejected");
  check((await call({ ...cs, idempotency_key: randomUUID() }, client.cookie)).status === 403, "Used proof cannot sign again with another key");
  check(adminSql(`select lifecycle from accordly.agreements where id='${aid}';`).trim() === "awaiting_signatures", "Database remains pending below unanimous quorum");
  adminSql(`update accordly.verification_proofs set verified_at=clock_timestamp()-interval '5 minutes',expires_at=clock_timestamp()-interval '1 second' where id='${pp.proof_id}';`);
  check((await call(ps, provider.cookie)).status === 403, "Expired consent proof cannot sign");
  pp = await proof(provider); ps = command(pp, "Provider");
  // Force failure at deferred COMMIT, after evidence/proof/activation writes.
  adminSql(`create function accordly_commands.signing_rollback_fixture() returns trigger language plpgsql as $$ begin if new.agreement_id='${aid}'::uuid and new.action='initial_signature' and new.typed_name='Provider' then raise exception 'fixture rollback'; end if; return null; end $$; create constraint trigger signing_rollback_fixture after insert on accordly.consent_decisions deferrable initially deferred for each row execute function accordly_commands.signing_rollback_fixture();`);
  check((await call(ps, provider.cookie)).status === 503, "Commit failure never returns successful signature");
  adminSql("drop trigger signing_rollback_fixture on accordly.consent_decisions; drop function accordly_commands.signing_rollback_fixture();");
  check(adminSql(`select count(*) from accordly.consent_decisions where agreement_id='${aid}';`).trim() === "1", "Rollback preserved only original partial signature");
  check(adminSql(`select consumed_at is null from accordly.verification_proofs where id='${pp.proof_id}';`).trim() === "t", "Rollback restored unused proof");
  const concurrent = await Promise.all([call(ps, provider.cookie), call(ps, provider.cookie)]);
  check(concurrent.every((r) => r.status === 200 && r.body.active && r.body.decision_id === concurrent[0].body.decision_id), "Concurrent identical final signatures activate exactly once");
  check(adminSql(`select count(*) from accordly.consent_decisions where agreement_id='${aid}';`).trim() === "2", "Exactly one immutable decision per required slot");
  check(adminSql(`select lifecycle||':'||(effective_version_id='${read.body.version_id}'::uuid)::text from accordly.agreements where id='${aid}';`).trim() === "active:true", "Activation points to exact signed version");
  check((await issuer({ operation: "revoke_invitation", agreement_id: aid, slot_id: clientSlot.slot_id, idempotency_key: randomUUID() })).status === 409, "Provider cannot revoke active client's history access");
  check((await call({ operation: "read" }, client.cookie)).status === 200, "Client retains authorized active agreement read");
  await amendmentIntegration({ api, base, a, b, aid, client, provider, original: read.body, adminSql, mailbox, check });
  check((await call({ operation: "logout" }, client.cookie)).status === 200, "Guest can revoke its session");
  check((await call({ operation: "read" }, client.cookie)).status === 403, "Stored revoked session is rejected");
  check((await call(cs, client.cookie)).status === 403, "Revoked session cannot replay a signature receipt");
  check(adminSql(`select bool_and(evidence_digest=sha256(evidence_bytes)) from accordly.consent_decisions where agreement_id='${aid}';`).trim() === "t", "Evidence hashes bind exact immutable bytes");
  check(adminSql(`select count(*) from accordly.audit_events where agreement_id='${aid}' and event_type='initial_signature';`).trim() === "2", "Exactly one audit event per signature including concurrent retries");
  check(adminSql(`select count(*) from accordly.audit_events where agreement_id='${aid}' and event_type='verify_access' and convert_from(canonical_event,'UTF8')::jsonb->>'version_id'='${read.body.version_id}';`).trim() === "2", "Both verified party bindings are audited atomically");
  check(adminSql(`select count(*) from accordly.outbox_events where agreement_id='${aid}' and event_type='initial_signature_recorded';`).trim() === "2", "Durable signature/activation intents deduplicate with receipts");
}
