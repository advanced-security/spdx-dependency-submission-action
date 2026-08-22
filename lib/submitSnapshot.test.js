import { jest } from '@jest/globals';

const mockRequest = jest.fn();
const mockGetOctokit = jest.fn(() => ({ request: mockRequest }));

jest.unstable_mockModule('@actions/github', () => ({
    getOctokit: mockGetOctokit
}));

const context = {
    repo: {
        owner: "advanced-security",
        repo: "spdx-dependency-submission-action"
    }
};

const fakeSnapshot = {
    prettyJSON: () => "{}"
};

describe("submitSnapshot", () => {
    let lib;

    beforeAll(async () => {
        process.env['INPUT_TOKEN'] = 'test-token';
        lib = await import('./index.js');
    });

    beforeEach(() => {
        mockRequest.mockReset();
        mockGetOctokit.mockClear();
    });

    test("configures the Octokit client with the retry plugin and non-retryable statuses", async () => {
        mockRequest.mockResolvedValue({
            data: { result: "SUCCESS", created_at: "2024-01-01T00:00:00Z" }
        });

        await lib.submitSnapshot(fakeSnapshot, context);

        expect(mockGetOctokit).toHaveBeenCalledTimes(1);
        const [, options, retryPlugin] = mockGetOctokit.mock.calls[0];
        expect(options.retry.doNotRetry).toEqual([400, 410, 422, 451]);
        expect(options.retry.doNotRetry).not.toContain(401);
        expect(options.retry.doNotRetry).not.toContain(403);
        expect(options.retry.doNotRetry).not.toContain(404);
        expect(typeof retryPlugin).toBe("function");
    });

    test("resolves when the snapshot is submitted successfully", async () => {
        mockRequest.mockResolvedValue({
            data: { result: "ACCEPTED", created_at: "2024-01-01T00:00:00Z" }
        });

        await expect(lib.submitSnapshot(fakeSnapshot, context)).resolves.toBeUndefined();
        expect(mockRequest).toHaveBeenCalledWith(
            "POST /repos/{owner}/{repo}/dependency-graph/snapshots",
            expect.objectContaining({
                owner: context.repo.owner,
                repo: context.repo.repo
            })
        );
    });

    test("throws a wrapped error when the request ultimately fails", async () => {
        const requestError = new Error("An error occurred while processing your request. Please try again later.");
        mockRequest.mockRejectedValue(requestError);

        await expect(lib.submitSnapshot(fakeSnapshot, context)).rejects.toThrow("Failed to submit snapshot");
    });
});
