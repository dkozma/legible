#[derive(Debug, PartialEq)]
pub enum ConfigError {
    NotANumber(String),
    OutOfRange(u32),
    EmptyRange(u16, u16),
}

#[derive(Debug, PartialEq)]
pub struct PortRange {
    pub first: u16,
    pub last: u16,
}

fn parse_one(s: &str) -> Result<u16, ConfigError> {
    let n: u32 = s
        .trim()
        .parse()
        .map_err(|_| ConfigError::NotANumber(s.to_string()))?;
    if n == 0 {
        return Err(ConfigError::OutOfRange(n));
    }
    Ok(n.min(65535) as u16)
}

pub fn parse_ports(s: &str) -> Result<PortRange, ConfigError> {
    match s.split_once('-') {
        Some((a, b)) => {
            let (first, last) = (parse_one(a)?, parse_one(b)?);
            if first > last {
                return Err(ConfigError::EmptyRange(first, last));
            }
            Ok(PortRange { first, last })
        }
        None => {
            let p = parse_one(s)?;
            Ok(PortRange { first: p, last: p })
        }
    }
}
