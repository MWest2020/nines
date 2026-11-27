# Content backlog

What still needs writing: the career paths' signature quests, karma's side jobs and contractor
quests, the Kubernetes learning path, and (below those) the system-design battle briefs, all four
of which are done. Write our own
questions: these are topics, not text to copy from anywhere.

## Career paths: signature quests and battles

DESIGN.md, Career paths. Each path gets a mentor in Medior City, a quest line, its own gate
interview into Senior Summit and a homelab item. Ideas to start from; tag every quest with its
`paths`.

- **Software Engineer (swe).** Quest: a flaky test that only fails on CI (a time zone, test
  order or a shared temp dir), found with git bisect in the terminal. Battle: a code review
  where a colleague defends a 900-line pull request (split it, what to ask, what to block on).
  Gate: a design interview on a news feed (fan-out on write vs read). Item: a mechanical
  keyboard (typing in the terminal pays a little XP bonus? keep it cosmetic first).
- **Site Reliability Engineer (sre).** Quest: alerts that page on every blip; rewrite one as an
  SLO burn-rate alert. Battle: a postmortem meeting that wants a name to blame (blameless
  framing, contributing factors, action items that are owned). Gate: an incident commander
  interview with three things on fire. Item: a status-page e-ink display.
- **DevOps Engineer (devops).** Quest: a deploy that works on one server and not the other
  (configuration drift); fix it with a small idempotent playbook. Battle: a release manager who
  wants a code freeze for a month (trunk-based development, feature flags, small batches).
  Gate: a pipeline design interview (build once, promote the artifact). Item: a self-hosted CI
  runner (pipelines in quests run faster? cosmetic first).
- **Platform Engineer (platform).** Quest: a team's app needs a database; build the golden path
  (a template that gives a namespace, quotas and a Deployment). Battle: a product team that
  refuses the platform ("we'll run our own cluster"): paved roads vs mandates. Gate: an
  interview on a multi-tenant cluster (namespaces, RBAC, quotas, network policies). Item: a
  three-node mini cluster of old laptops.
- **Systems Engineer (systems).** Quest: a server that cannot reach the internet (a default
  route, then MTU); `ip route`, `ping -M do`. Battle: a vendor who wants to replace the RAID
  with "the cloud" by Friday (backups, restore tests, what RAID is not). Gate: a hardware
  failure triage interview (SMART data, ECC errors, a dying PSU). Item: a second-hand rack
  switch.

## Karma: side jobs, contractor quests, the ethical hacker's line

DESIGN.md, Karma. The engine is built; these are content. Every hack stays abstract and fictional
(a misplaced folder, a default left in a fictional README, a fictional bucket), never a real
technique, tool or payload, and every hustle ends on the legal way (security.txt, bug bounties,
responsible disclosure).

- **Side jobs (Vince, `kind: hustle`).** Each with a risk whose factors reward care.
  - *Report it instead* (the vending job's other ending, `kind: job`): the same open share, but
    the player writes to Munchr's security contact (a `security.txt` in the share) and gets a
    small bug bounty and karma +15. Vince is disappointed. Needs no new engine.
  - *The parking garage* (`karma <= -20`): a garage's ticket machine prints "admin password: see
    sticker". Get a free exit for a client. Heat: the camera log, how long you stand there.
  - *The fake reviews* (stakeholder battle, not a terminal): a restaurant owner wants 50 five-star
    reviews. A conversation about why that is fraud, and what to do for the restaurant instead.
- **Contractor quests (`procedure` objectives).**
  - *Friday deploy for the florist*: a release with a migration; procedures are a dry run and a
    rollback note. Damage: the migration run twice.
  - *The DNS cutover*: lower the TTL a day ahead (a procedure), or skip it and wait out the old
    TTL with a customer on the phone. Damage: deleting the old record too early.
  - *Contract terms* (battle): a client wants unlimited liability in the contract. What a
    contractor's insurance, scope and change requests are for.
- **Ethical hacker (`paths: [ethical]`).** A `security` branch arrives with the Medior line, so the
  Junior trail keeps its six rows.
  - Junior, more: *the CTF night* (Thursdays, Sanne): three small flags on a practice box (a
    world-readable config, a forgotten debug page, a weak file permission), each written up.
  - Medior: *a web app assessment* with a scope that excludes production; *responsible
    disclosure* as a battle (the vendor stalls; deadlines, CVE, coordinated publication); the gate
    into Senior Summit: a red team versus blue team debrief.
  - Item: a lock-picking practice set for the homelab shelf (cosmetic; the CTF crowd will get it).

## Kubernetes learning path

DESIGN.md, Kubernetes learning path, with the exam domains and their sources (read 27 Nov 2026;
recheck the weights before writing). Junior follows KCNA, Medior CKAD, Senior CKA and CKS. Our
own scenarios and questions; never exam dumps or official question text. Done: CrashLoopBackOff
(`content/quests/crashloop-config`, KCNA, Kubernetes Fundamentals).

### Junior: KCNA (multiple choice, concepts)

- **Container Orchestration (28%)**, node `k8s-orchestration`: a battle with Mila on Services
  and storage. Pod IPs change, so what gives a stable name (a Service, its ClusterIP and DNS
  name); ClusterIP vs NodePort vs LoadBalancer; a PersistentVolumeClaim vs an emptyDir (an
  emptyDir survives a container restart but not the pod being deleted or rescheduled); why a Secret is only base64 (encoding, not encryption) and what
  RBAC is for. Traps: "a Deployment gives the pods a fixed IP".
- **Cloud Native Application Delivery (16%)**, node `k8s-delivery`: a terminal quest with a bad
  image tag (ImagePullBackOff): `kubectl describe` shows the pull error, fix the tag in the
  manifest, apply; then a rolling update and a rollback. Simulator: `kubectl set image`,
  `kubectl rollout status|undo|history`.
- **Cloud Native Architecture (12%)**, node `k8s-architecture`: a battle on what the control
  plane does (API server, etcd, scheduler, controller manager; the kubelet on each node),
  declarative desired state and reconciliation, the three pillars of observability, and what
  the CNCF is (projects by maturity: sandbox, incubating, graduated). Traps: "etcd runs your
  containers".

### Medior: CKAD (hands-on)

Domains: Application Design and Build 20%, Application Deployment 20%, Application
Observability and Maintenance 15%, Application Environment, Configuration and Security 25%,
Services and Networking 20%.

- Design and Build: a CronJob that never runs (bad schedule) and an init container waiting for
  a database; a sidecar that ships logs.
- Deployment: a canary with two Deployments behind one Service (replica ratio), a Helm release
  upgrade that went wrong (`helm rollback`), a Kustomize overlay for staging.
- Observability and Maintenance: a liveness probe that kills a slow-starting app (fix it with a
  startup probe), a deprecated API version in a manifest.
- Environment, Configuration and Security: requests and limits (an OOMKilled pod), a Secret
  mounted as a file, a ServiceAccount, a securityContext that runs as non-root.
- Services and Networking: a Service whose selector matches nothing (no endpoints), an Ingress
  rule with the wrong path, a NetworkPolicy that blocks the frontend.
- Simulator: `kubectl get svc|endpoints|deploy|cm|secret|events`, `describe` for more kinds,
  `create`, `expose`, `scale`, `set image`, `rollout undo`, `exec`, `top`, `logs -c`, a `helm`
  subset.

### Senior: CKA (hands-on)

Domains: Storage 10%, Troubleshooting 30%, Workloads & Scheduling 15%, Cluster Architecture,
Installation & Configuration 25%, Services & Networking 20%.

- Troubleshooting: a node NotReady (the kubelet is stopped: `systemctl status kubelet` on the
  node, the journal), a pod Pending on taints or resources, CoreDNS crash-looping.
- Storage: a PVC stuck Pending (no StorageClass, wrong access mode), a reclaim policy that
  deleted data.
- Workloads & Scheduling: node affinity and taints/tolerations, a HorizontalPodAutoscaler that
  never scales (no metrics), a rollback.
- Cluster Architecture: RBAC (a Role and RoleBinding for a team), a kubeadm upgrade in the right
  order (control plane first, drain, then nodes), backing up and restoring etcd.
- Services & Networking: Gateway API vs Ingress, NodePort vs LoadBalancer, a NetworkPolicy
  default deny with the right exceptions.

### Senior: CKS (hands-on; CKA required)

Domains: Cluster Setup 15% (LF) or 10% (CNCF), Cluster Hardening 15%, System Hardening 10% (LF)
or 15% (CNCF), Minimize Microservice Vulnerabilities 20%, Supply Chain Security 20%,
Monitoring, Logging and Runtime Security 20%. The two pages disagreed on 27 Nov 2026; recheck.

- Cluster Setup: default-deny NetworkPolicies, protecting the cloud metadata endpoint, a CIS
  benchmark finding on the kubelet.
- Cluster Hardening: an over-broad ClusterRoleBinding, a ServiceAccount token that is mounted
  everywhere, an old cluster version.
- System Hardening: an AppArmor or seccomp profile for a pod, removing packages from a node.
- Microservice Vulnerabilities: Pod Security Standards (restricted), Secrets at rest, mTLS
  between pods.
- Supply Chain: a base image with a known CVE, an unsigned image refused by policy, an SBOM.
- Runtime Security: an audit log that shows who exec'd into a pod, a container writing to its
  root filesystem (make it read-only).

## System-design battles (all done)


System-design topics that need a battle (ARCHITECTURE.md, Battles; CONTRIBUTING.md for
the folder layout). Each paragraph lists what the battle must test, at software-engineering
interview level, and the traps worth turning into wrong options. Write our own questions: these
are topics, not text to copy from anywhere. Where something is debatable, the explanation in
the battle must say so.

Done: the rate limiter (Junior), `content/quests/rate-limiter-interview/`; nearby places search
(Junior) and the URL shortener (Medior), `content/quests/nearby-places/` and
`content/quests/url-shortener/` (https://github.com/MWest2020/nines/pull/11); ticket booking and the collaborative editor
(Senior), `content/quests/ticket-booking-interview/` and `content/quests/collab-editor-interview/`
(https://github.com/MWest2020/nines/pull/13). Their paragraphs below stay as the brief they were
written from. All four topics are done.

Every battle uses the five round types where they fit: `clarify` (what to ask first),
`tradeoff` (a choice with its reason), `flaw` (spot the flaw in a proposal), `estimate`
(back-of-envelope ranges) and `order`. Each needs a `why` for every option, in English and
Dutch.

## Nearby places search · Junior · design · done

Written as `content/quests/nearby-places/` (Ravi, Junior Village, https://github.com/MWest2020/nines/pull/11).


Clarify first: radius search ("cafés within 1 km") or the k nearest; how many places (say 100
million) and how often they change (rarely: the system is read-heavy, so the index can be built
ahead and cached); straight-line distance or travel time (straight-line, for this battle). The
naive answer scans every place and computes the distance, which is O(N) per query; a B-tree
index on latitude and another on longitude does not fix it, because a range on one column still
leaves a band around the whole planet to filter. **Geohash**: interleave the bits of longitude
and latitude and write them in base32; a longer shared prefix means a smaller shared cell (5
characters is about 4.9 × 4.9 km, 6 about 1.2 × 0.6 km at the equator), so a plain string index
answers "which places are in this cell". The trap for a `flaw` round: two points a few metres
apart can sit in different cells with no common prefix, so the query must cover the user's
cell **and its 8 neighbours**, at a precision whose cells are at least the search radius in
both directions (5 characters for 1 km: 6-character cells are only 0.6 km north to south). **Quadtree**:
split a square into four whenever it holds more than K places, so dense city centres get small
cells and the countryside large ones; usually held in memory on each search server and rebuilt
or patched as places change. The `tradeoff` is debatable and the explanation must say so:
geohash is simple to store, index and shard in any database (Redis GEO stores a 52-bit geohash
as a sorted-set score), while a quadtree adapts to density; S2 cells, H3 hexagons and an R-tree
(PostGIS GiST) are also good answers. After the cell lookup, rank the candidates by exact
distance (haversine); a degree of longitude shrinks with the cosine of the latitude, so a box of
"0.01° by 0.01°" is not square away from the equator. An `estimate`: 100 million places at
around 50 bytes each for the index is about 5 GB, which fits in memory on one machine;
replicate it for reads.

## URL shortener · Medior · design · done

Written as `content/quests/url-shortener/` (Ingrid, at the gate until Medior City has a map,
https://github.com/MWest2020/nines/pull/11). One correction to the text below: a cached "not
found" absorbs repeated misses (a popular dead link), not scanners, whose random codes are each
a new miss; scanners are a job for the rate limiter or a Bloom filter of existing codes.


Clarify: how many new links per day, the read-to-write ratio (often around 100 to 1), custom
aliases, expiry, whether click analytics are needed and whether a link's target can change.
**Estimate**: 100 million new links a month is about 40 writes per second (a month is about
2.6 million seconds); at 100:1 that is about 4,000 redirects per second; five years is 6 billion
links, at about 500 bytes each roughly 3 TB. **IDs in base62** (a–z, A–Z, 0–9): 62⁶ ≈ 57 billion
and 62⁷ ≈ 3.5 trillion, so 7 characters leave ample room for 6 billion links. The `tradeoff`
round compares ID generation: a counter (a database sequence or a ticket server that hands each
app server a block of IDs, so they need no coordination per request) encoded in base62, which
never collides but is guessable, so private links can be enumerated unless the number is
scrambled with a reversible permutation; a hash of the long URL cut to 7 characters, which
maps the same URL to the same code (deduplication, unwanted if every user wants their own
statistics) and must detect collisions (with billions of codes in a 3.5-trillion space they do
happen) and retry with a salt; or random codes inserted only if absent (a unique constraint
catches the rare collision). A `flaw` round: "each app server keeps its own auto-increment
counter in memory" (duplicates across servers, and a reset after every restart). The redirect
status is debatable and the explanation must say so: **301** (permanent) is cached by browsers,
so repeat clicks never reach you (less load, but no click counts, and you cannot change or
disable the link for those users); **302** or **307** sends every click through you (analytics
and editable targets, at the cost of load). Storage is a key-value lookup by code, sharded by
code. Clicks are heavily skewed toward a few links, so cache hot codes in memory (cache-aside
with LRU eviction) or at a CDN, and cache "not found" briefly to absorb scanners. Link creation
needs abuse controls: rate limits (the Junior battle) and a check of target URLs against known
malware and phishing lists.

## Ticket booking · Senior · design · done

**Done** in `content/quests/ticket-booking-interview/` (https://github.com/MWest2020/nines/pull/13). It waits
for the Senior Summit map (ARCHITECTURE.md, Content ahead of its map). The brief stays below for reference.

Clarify: assigned seats or general admission; how hot the sale is (100,000 people at 10:00 for
50,000 seats); how long checkout and payment take; seats per order. The invariant: **a seat is
never sold twice**. A **hold with a TTL** (say 10 minutes) reserves a seat while the buyer pays;
store it as `expires_at` and treat an expired hold as free when claiming, with a sweeper only for
tidiness, never relying on a timer firing on time, and take the time from one clock (the
database's), not from each app server. Claim with one **conditional write** and check that
exactly one row changed: `UPDATE seats SET state = 'held', hold_id = ?, expires_at = now() +
interval '10 minutes' WHERE event_id = ? AND seat_id = ? AND (state = 'free' OR (state = 'held'
AND expires_at < now()))`; alternatives are `SELECT ... FOR UPDATE` in a transaction (a
pessimistic row lock) or a version column (optimistic concurrency), with a unique constraint on
(event, seat) in the tickets table as the last line of defence. A `flaw` round: read "free" in
the application, then write "held" (two buyers both read free). Distributed locks in a cache are
debatable and the explanation must say so: without fencing tokens, a process that paused past
its lock's expiry can still write (the well-known critique of Redis-based locking), so the
database's conditional write should stay the source of truth. **Idempotency**: the client sends
an idempotency key with "confirm and pay"; the server stores the key with the outcome, so a retry
after a timeout returns the same booking instead of charging or booking twice, and the payment
provider gets the same key. Edge case for an `order` or `tradeoff` round: payment succeeds after
the hold expired; extend the hold while a payment is in flight, or detect it and refund, but never
hand the seat to a second buyer. A hot sale needs a virtual waiting room that admits buyers at a
rate the booking path can take; the seat map can come from a cache that is seconds stale, as long
as only the conditional write decides. An `estimate`: 50,000 seats in 10 minutes is about 83
bookings per second on average, while hold attempts on the best seats run many times higher, so
contention, not throughput, is the problem.

## Collaborative document editor · Senior · design · done

**Done** in `content/quests/collab-editor-interview/` (https://github.com/MWest2020/nines/pull/13). It waits
for the Senior Summit map (ARCHITECTURE.md, Content ahead of its map). The brief stays below for reference.

Clarify: plain or rich text; how many people edit one document at once (tens, not thousands);
offline editing (yes); history and undo; the latency people expect (their own keystrokes show at
once). Edits are operations (insert or delete at a position). Two wrong answers make good
`flaw` options: last-writer-wins on the whole document (one person's work disappears) and
locking paragraphs (safe, but people wait on each other). **Operational transformation (OT)**
transforms concurrent operations against each other (an insert at position 5 shifts a concurrent
insert at position 8 to 9); in practice a central server puts operations in one order and
clients transform their pending edits against what the server sent, as Google Docs does.
Getting the transform functions right is notoriously hard, especially without a central
server. **CRDTs** give every character a unique, ordered identifier (RGA, or YATA as used by Yjs,
or Automerge's list type) and make merging commutative, associative and idempotent, so replicas
that have seen the same operations end up identical in any order, with no central server
needed; that suits offline work and peer-to-peer. Their costs belong in the `tradeoff`
explanation: metadata per character, deleted characters kept as tombstones (memory and document
size; garbage collection needs care), and some algorithms can interleave the characters of two
concurrent insertions at the same spot. **Offline merge**: the client keeps a log of local
operations; on reconnect, OT has to transform the whole backlog against everything the server
accepted since the client's last known version (fine for minutes, costly and error-prone after
days), while a CRDT exchanges what each side is missing (version vectors) and merges. Debatable,
and the explanation must say so: both converge, neither understands meaning, so two people
fixing the same typo differently can both be applied and a human has to look. The server keeps
the operation log plus periodic snapshots and speaks WebSockets; presence (cursors, who is
online) is ephemeral and never stored. Rich text adds formatting ranges whose merges are harder
than plain characters. Undo undoes your own last operation, not the last one in the document. An
`estimate`: a fast typist makes 5 to 10 keystrokes a second, so batch them into one message every
50 to 100 ms.
