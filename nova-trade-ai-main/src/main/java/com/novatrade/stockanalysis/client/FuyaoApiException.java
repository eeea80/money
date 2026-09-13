package com.novatrade.stockanalysis.client;

public class FuyaoApiException extends RuntimeException {

    private final int upstreamCode;
    private final String requestId;

    public FuyaoApiException(int upstreamCode, String message, String requestId) {
        super(message);
        this.upstreamCode = upstreamCode;
        this.requestId = requestId;
    }

    public int getUpstreamCode() {
        return upstreamCode;
    }

    public String getRequestId() {
        return requestId;
    }
}
