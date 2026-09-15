const MENTOR_CONVERSATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidMentorConversationUuid(value) {
  return (
    typeof value === "string" &&
    MENTOR_CONVERSATION_UUID_PATTERN.test(value)
  );
}

async function getMentorConversation(data = {}) {
  const conversationId = String(data.conversationId || "").toLowerCase();
  const afterSequence = Number(data.afterSequence || 0);
  const expectedAuthSubject =
    typeof data.expectedAuthSubject === "string"
      ? data.expectedAuthSubject
      : null;
  if (
    !isValidMentorConversationUuid(conversationId) ||
    !Number.isSafeInteger(afterSequence) ||
    afterSequence < 0 ||
    !expectedAuthSubject
  ) {
    return {
      success: false,
      error: "Invalid conversation request.",
      code: "invalid_conversation_request",
    };
  }

  const query = new URLSearchParams({
    conversation_id: conversationId,
    after_sequence: String(afterSequence),
    limit: "100",
  });
  return apiRequest(`/mentor-conversation?${query.toString()}`, {
    method: "GET",
    expectedAuthSubject,
  });
}

async function saveMentorConversationMessages(data = {}) {
  const expectedAuthSubject =
    typeof data.expectedAuthSubject === "string"
      ? data.expectedAuthSubject
      : null;
  if (!expectedAuthSubject || !isValidMentorConversationUuid(data.conversationId)) {
    return {
      success: false,
      error: "Invalid conversation request.",
      code: "invalid_conversation_request",
    };
  }

  return apiRequest("/mentor-conversation", {
    method: "POST",
    body: JSON.stringify({
      conversationId: data.conversationId,
      analysisId: data.analysisId || null,
      symbol: data.symbol || null,
      timeframe: data.timeframe || null,
      messages: data.messages,
    }),
    expectedAuthSubject,
  });
}
