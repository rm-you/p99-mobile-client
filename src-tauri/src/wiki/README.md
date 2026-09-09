The Wiki lookup fetches only a selected public item title. It parses the
`.itemtitle` / `.itemdata` card to plain text, never rendering remote HTML.
Requests are HTTPS-only, redirects are disabled, responses are capped at 512 KiB,
and successful results have a 24-hour, 128-item in-memory cache.

The Wiki served only its leaf certificate during testing on 2026-09-08. The
included `ssl-com-r1.der` is the public **SSL.com TLS Issuing RSA CA R1**
intermediate, exported from the chain Windows completed for the Wiki. Its public
issuer URL is http://cert.ssl.com/SSL.com-TLS-I-RSA-R1.cer.

SHA-256: `bfbc39e9fa2b84c9a92337e2344ee2381d8d3d3ae8ea75ef4e48e5807ed80c69`

This certificate is supplied as **untrusted intermediate chain material** only
for `wiki.project1999.com`. It is not added to the trusted roots. Rustls WebPKI
still verifies the hostname, validity, certificate signatures, and chain to the
Mozilla roots from `webpki-roots`. An invalid certificate remains an error.
Remove the supplemental intermediate when the Wiki consistently serves its full
chain. A future certificate issued by a different authority can validate through
its server-supplied chain without using this intermediate.
