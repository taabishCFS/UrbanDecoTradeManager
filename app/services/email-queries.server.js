import prisma from "../db.server";

const SNIPPET_LENGTH = 120;

/* ============================================================
   PURE: BUILD THE LIST PAGE ROWS
============================================================ */

export function buildThreadList(applications, query = "") {
  const needle = query.trim().toLowerCase();

  return applications
    .filter((application) => application.emailMessages.length > 0)
    .map((application) => {
      const messages = [...application.emailMessages].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      const latest = messages[0];

      return {
        applicationId: application.id,
        applicantName: `${application.firstName} ${application.lastName}`.trim(),
        businessName: application.businessName,
        email: application.email,
        latest: {
          direction: latest.direction,
          subject: latest.subject,
          snippet: latest.bodyText.slice(0, SNIPPET_LENGTH),
          createdAt: latest.createdAt,
        },
        unreadCount: messages.filter(
          (message) => message.direction === "INBOUND" && !message.readAt
        ).length,
      };
    })
    .filter((thread) =>
      needle
        ? [thread.applicantName, thread.businessName, thread.email].some(
            (value) => value.toLowerCase().includes(needle)
          )
        : true
    )
    .sort((a, b) => new Date(b.latest.createdAt) - new Date(a.latest.createdAt));
}

/* ============================================================
   DATABASE QUERIES
============================================================ */

export async function listThreads(query = "") {
  const applications = await prisma.tradeApplication.findMany({
    where: { emailMessages: { some: {} } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      email: true,
      emailMessages: {
        select: {
          direction: true,
          bodyText: true,
          subject: true,
          createdAt: true,
          readAt: true,
        },
      },
    },
  });

  return buildThreadList(applications, query);
}

export async function getThread(applicationId) {
  return prisma.tradeApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      email: true,
      emailMessages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          direction: true,
          kind: true,
          fromEmail: true,
          toEmail: true,
          subject: true,
          bodyText: true,
          readAt: true,
          createdAt: true,
        },
      },
    },
  });
}

export async function markThreadRead(applicationId) {
  return prisma.emailMessage.updateMany({
    where: { applicationId, direction: "INBOUND", readAt: null },
    data: { readAt: new Date() },
  });
}

export async function listUnmatched() {
  return prisma.emailMessage.findMany({
    where: { applicationId: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      direction: true,
      fromEmail: true,
      toEmail: true,
      subject: true,
      bodyText: true,
      createdAt: true,
    },
  });
}

export async function countUnmatched() {
  return prisma.emailMessage.count({ where: { applicationId: null } });
}

export async function listApplicationOptions() {
  return prisma.tradeApplication.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      email: true,
    },
  });
}

export async function assignUnmatched(messageId, applicationId) {
  return prisma.emailMessage.updateMany({
    where: { id: messageId, applicationId: null },
    data: { applicationId },
  });
}
