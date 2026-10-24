import { prisma } from "@js/database";
import { assertNavigationAllowed, matchesAuthorizedHost, parseTargetUrl, UrlPolicyError, type AuthorizedHost, type NetworkPolicy } from "@js/security";
import { collectNavigationUrls, usableDomainStatuses, type ScenarioDefinition } from "@js/shared";

export async function loadAuthorizedHosts(projectId: string): Promise<AuthorizedHost[]> {
  const domains = await prisma.verifiedDomain.findMany({ where: { projectId, status: { in: usableDomainStatuses(process.env) } } });
  return domains.map((d) => ({ hostname: d.hostname, port: d.port, allowSubdomains: d.allowSubdomains }));
}

export interface TargetIssue {
  path: string;
  message: string;
}

/**
 * Check every URL a scenario navigates to directly. With `resolveDns` the
 * SSRF policy is applied too (used before launching runs).
 */
export async function checkScenarioTargets(
  def: ScenarioDefinition,
  hosts: AuthorizedHost[],
  policy: NetworkPolicy,
  resolveDns: boolean,
): Promise<TargetIssue[]> {
  const issues: TargetIssue[] = [];
  const urls = collectNavigationUrls(def);
  const paths = ["startUrl", ...def.steps.map((s, i) => (s.type === "NAVIGATE" ? `steps.${i}.url` : null)).filter((p): p is string => p !== null)];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!.toString();
    try {
      if (resolveDns) await assertNavigationAllowed(url, hosts, policy);
      else {
        const u = parseTargetUrl(url);
        if (!matchesAuthorizedHost(u, hosts)) throw new UrlPolicyError(`${u.host} is not an authorized website of this project`, "UNAUTHORIZED_HOST");
      }
    } catch (err) {
      issues.push({ path: paths[i] ?? "startUrl", message: err instanceof Error ? err.message : String(err) });
    }
  }
  return issues;
}
