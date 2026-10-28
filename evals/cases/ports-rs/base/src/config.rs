#[derive(Debug, PartialEq)]
pub enum ConfigError {
    NotANumber(String),
    OutOfRange(u32),
}

pub fn parse_port(s: &str) -> Result<u16, ConfigError> {
    let n: u32 = s
        .parse()
        .map_err(|_| ConfigError::NotANumber(s.to_string()))?;
    if n == 0 || n > 65535 {
        return Err(ConfigError::OutOfRange(n));
    }
    Ok(n as u16)
}
