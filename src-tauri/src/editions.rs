use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Edition {
    pub name: String,
    pub label: String,
    pub description: String,
    pub iso_url: String,
    pub zip_url: String,
    pub source_url: String,
}

pub fn load() -> Vec<Edition> {
    let json = include_str!("../editions.json");
    serde_json::from_str(json).unwrap_or_default()
}
