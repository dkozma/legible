mod config;

use std::net::TcpListener;

fn main() {
    let port = config::parse_port(&std::env::var("PORT").unwrap_or("8080".into()))
        .expect("invalid PORT");
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind");
    println!("listening on {}", listener.local_addr().unwrap());
}
