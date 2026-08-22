import { jest } from '@jest/globals';

const workflowContext = {
  job: "test-job",
  runId: 123
};
const submissionContext = {
  ...workflowContext,
  ref: "refs/heads/target",
  repo: {
    owner: "target-owner",
    repo: "target-repo"
  },
  sha: "target-sha"
};
const snapshot = {
  addManifest: jest.fn()
};
const Snapshot = jest.fn(() => snapshot);
const submitSnapshot = jest.fn();
const getInput = jest.fn(name => ({
  correlator: "test-correlator",
  repoPath: "target-repo"
})[name] ?? "");
const getSubmissionContext = jest.fn(() => submissionContext);

jest.unstable_mockModule('@actions/core', () => ({
  getInput
}));
jest.unstable_mockModule('@actions/github', () => ({
  context: workflowContext
}));
jest.unstable_mockModule('@github/dependency-submission-toolkit', () => ({
  Snapshot
}));
jest.unstable_mockModule('./lib/index.js', () => ({
  getManifestsFromSpdxFiles: jest.fn(() => []),
  getSubmissionContext,
  searchFiles: jest.fn(() => []),
  submitSnapshot
}));

beforeAll(async () => {
  await import('./index.js');
});

test("uses the submission context for snapshot metadata and API routing", () => {
  expect(Snapshot).toHaveBeenCalledWith(
    expect.any(Object),
    submissionContext,
    {
      correlator: "test-correlator",
      id: "123"
    }
  );
  expect(getSubmissionContext).toHaveBeenCalledWith(workflowContext, "target-repo");
  expect(getInput).toHaveBeenCalledWith("repoPath");
  expect(submitSnapshot).toHaveBeenCalledWith(snapshot, submissionContext);
});
