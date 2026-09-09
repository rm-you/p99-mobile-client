use rustls::{
    client::{
        danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
        WebPkiServerVerifier,
    },
    pki_types::{CertificateDer, ServerName, UnixTime},
    ClientConfig, DigitallySignedStruct, Error, RootCertStore, SignatureScheme,
};
use std::sync::Arc;

/// The Wiki currently serves only its leaf certificate. Supply its public
/// intermediate as untrusted chain material, NEVER as an additional trust root.
/// WebPKI still verifies the hostname, validity, signatures, and Mozilla trust.
#[derive(Debug)]
struct WikiChainVerifier(Arc<WebPkiServerVerifier>);
impl ServerCertVerifier for WikiChainVerifier {
    fn verify_server_cert(
        &self,
        end: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        let mut chain = intermediates.to_vec();
        if matches!(name, ServerName::DnsName(dns) if dns.as_ref() == "wiki.project1999.com") {
            chain.push(CertificateDer::from(
                include_bytes!("ssl-com-r1.der").as_slice(),
            ));
        }
        self.0.verify_server_cert(end, &chain, name, ocsp, now)
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.0.verify_tls12_signature(message, cert, dss)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.0.verify_tls13_signature(message, cert, dss)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.supported_verify_schemes()
    }
}

pub(super) fn configuration() -> Result<ClientConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let verifier = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider.clone())
        .build()
        .map_err(|_| "Could not initialize Wiki certificate verification.")?;
    Ok(ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| "Could not initialize Wiki HTTPS.")?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(WikiChainVerifier(verifier)))
        .with_no_client_auth())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_public_intermediate_does_not_become_a_trusted_server_certificate() {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let verifier = WikiChainVerifier(
            WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider)
                .build()
                .unwrap(),
        );
        let intermediate = CertificateDer::from(include_bytes!("ssl-com-r1.der").as_slice());
        let name = ServerName::try_from("wiki.project1999.com").unwrap();
        // An issuer certificate must not be accepted as the Wiki leaf, even
        // though it is also supplied as chain material by our wrapper.
        assert!(verifier
            .verify_server_cert(
                &intermediate,
                &[],
                &name,
                &[],
                UnixTime::since_unix_epoch(std::time::Duration::from_secs(1_790_000_000))
            )
            .is_err());
    }
}
