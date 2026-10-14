import "./setupDisposableDatabase.js";
import db from "../prisma/client.js";
import { checkOnlineMeeting, startMeetPollingWorker } from "../services/meetVerificationService.js";

process.send({ ready: true });
process.once("message", async ({ id, mode, now }) => {
  const row = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id } });
  const conferenceName = `conferenceRecords/restart-${id}`;
  const conference = { name: conferenceName, space: "spaces/restart", startTime: row.startsAt.toISOString(), endTime: row.endsAt.toISOString() };
  const fetcher = async input => {
    const resource = new URL(input).pathname.slice(4);
    let body;
    if (resource.startsWith("spaces/")) body = { name: "spaces/restart", meetingCode: new URL(row.meetUrl).pathname.slice(1) };
    else if (resource === "conferenceRecords") body = { conferenceRecords: [conference] };
    else if (resource === conferenceName) body = conference;
    else if (resource === `${conferenceName}/participants`) {
      if (mode === "crash") {
        process.send({ evidenceSaved: true });
        await new Promise(() => {});
      }
      body = { participants: ["teacher", "student"].map(name => ({ name: `${conferenceName}/participants/${name}`, signedinUser: { user: `users/${name}`, displayName: "Isolated participant" } })) };
    } else if (resource.endsWith("/participantSessions")) body = { participantSessions: [{ name: `${resource}/session`, startTime: conference.startTime, endTime: conference.endTime }] };
    else throw new Error("Unexpected isolated Google request");
    return new Response(JSON.stringify(body));
  };
  // Exercise the real worker lifecycle, restricted to this test-owned class.
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stop = startMeetPollingWorker({ env: { ENABLE_MEET_POLLING: "true" }, poll: async () => {
    const result = await checkOnlineMeeting(id, row.facultyId, { db, fetcher, getToken: async () => "isolated-provider-token", now: new Date(now) });
    process.send({ result: { status: result.status, pending: result.verificationPending === true } });
    finish();
  } });
  await done;
  await stop();
  await db.$disconnect();
  process.disconnect();
});
