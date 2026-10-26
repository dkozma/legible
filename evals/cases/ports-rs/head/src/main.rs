mod config;

use std::net::TcpListener;

fn main() {
    let range = config::parse_ports(&std::env::var("PORT").unwrap_or("8080".into()))
        .expect("invalid PORT");
    let listener = (range.first..=range.last)
        .find_map(|p| TcpListener::bind(("127.0.0.1", p)).ok())
        .expect("no free port in range");
    println!("listening on {}", listener.local_addr().unwrap());
}
