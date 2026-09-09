use super::ItemDetails;
use anyhow::{ensure, Context, Result};
use rusqlite::Row;

const SIZES: &[&str] = &["TINY", "SMALL", "MEDIUM", "LARGE", "GIANT"];
const CLASSES: &[&str] = &[
    "WAR", "CLR", "PAL", "RNG", "SHD", "DRU", "MNK", "BRD", "ROG", "SHM", "NEC", "WIZ", "MAG",
    "ENC",
];
const RACES: &[&str] = &[
    "HUM", "BAR", "ERU", "ELF", "HIE", "DEF", "HEF", "DWF", "TRL", "OGR", "HFL", "GNM", "IKS",
];
const SLOTS: &[&str] = &[
    "CHARM",
    "EAR",
    "HEAD",
    "FACE",
    "EAR",
    "NECK",
    "SHOULDERS",
    "ARMS",
    "BACK",
    "WRIST",
    "WRIST",
    "RANGE",
    "HANDS",
    "PRIMARY",
    "SECONDARY",
    "FINGER",
    "FINGER",
    "CHEST",
    "LEGS",
    "FEET",
    "WAIST",
    "AMMO",
];
const DEITIES: &[&str] = &[
    "Agnostic",
    "Bertoxxulous",
    "Brell Serilis",
    "Cazic-Thule",
    "Erollisi Marr",
    "Bristlebane",
    "Innoruuk",
    "Karana",
    "Mithaniel Marr",
    "Prexus",
    "Quellious",
    "Rallos Zek",
    "Rodcet Nife",
    "Solusek Ro",
    "The Tribunal",
    "Tunare",
    "Veeshan",
];
const STATS: &[(&str, &str)] = &[
    ("ac", "AC"),
    ("damage", "DMG"),
    ("delay", "Delay"),
    ("range", "Range"),
    ("astr", "STR"),
    ("adex", "DEX"),
    ("asta", "STA"),
    ("acha", "CHA"),
    ("awis", "WIS"),
    ("aint", "INT"),
    ("aagi", "AGI"),
    ("hp", "HP"),
    ("mana", "Mana"),
    ("fr", "SV FIRE"),
    ("dr", "SV DISEASE"),
    ("cr", "SV COLD"),
    ("mr", "SV MAGIC"),
    ("pr", "SV POISON"),
    ("regen", "HP Regen"),
    ("manaregen", "Mana Regen"),
    ("attack", "Attack"),
    ("damageshield", "Damage Shield"),
];

fn number(row: &Row<'_>, name: &str) -> rusqlite::Result<i64> {
    row.get::<_, Option<i64>>(name)
        .map(|value| value.unwrap_or(0))
}

/// Expand recognized classic-era bits and collapse duplicate paired slots.
fn mask_names(mask: i64, names: &[&str], all: bool, later_bits: i64) -> Result<String> {
    ensure!(
        mask >= 0 && (mask & !later_bits) >> names.len() == 0,
        "Unsupported item bitmask"
    );
    let mask = mask & !later_bits;
    if all && mask == (1 << names.len()) - 1 {
        return Ok("ALL".into());
    }
    let mut labels = Vec::new();
    for (index, &name) in names.iter().enumerate() {
        if mask & (1 << index) != 0 && !labels.contains(&name) {
            labels.push(name);
        }
    }
    Ok(labels.join(" "))
}

fn size(value: i64) -> Result<&'static str> {
    SIZES
        .get(usize::try_from(value)?)
        .copied()
        .context("Unsupported item size")
}

/// Format one upstream row for the modal; expansion-only fields remain in the database.
pub(super) fn item_details(row: &Row<'_>) -> Result<ItemDetails> {
    let mut flags = Vec::new();
    if number(row, "magic")? != 0 {
        flags.push("MAGIC ITEM");
    }
    if number(row, "loreGroup")? != 0 {
        flags.push("LORE ITEM");
    }
    // EQEmu/PEQ stores these two flags inverted.
    if number(row, "nodrop")? == 0 {
        flags.push("NO DROP");
    }
    if number(row, "norent")? == 0 {
        flags.push("NO RENT");
    }
    let mut lines = Vec::new();
    if !flags.is_empty() {
        lines.push(flags.join(" · "));
    }
    if number(row, "slots")? != 0 {
        lines.push(format!(
            "Slot: {}",
            mask_names(number(row, "slots")?, SLOTS, false, 0)?
        ));
    }
    if number(row, "damage")? != 0 {
        let skill = match number(row, "itemType")? {
            0 => Some("1H Slashing"),
            1 => Some("2H Slashing"),
            2 => Some("Piercing"),
            3 => Some("1H Blunt"),
            4 => Some("2H Blunt"),
            5 => Some("Archery"),
            7 | 19 => Some("Throwing"),
            35 => Some("2H Piercing"),
            45 => Some("Hand to Hand"),
            _ => None,
        };
        if let Some(skill) = skill {
            lines.push(format!("Skill: {skill}"));
        }
    }
    for &(column, label) in STATS {
        let value = number(row, column)?;
        if value != 0 {
            lines.push(format!("{label}: {value}"));
        }
    }
    let haste = number(row, "haste")?;
    if haste != 0 {
        lines.push(format!("Haste: {haste}%"));
    }
    for (column, label) in [
        ("clickName", "Click effect"),
        ("procName", "Combat effect"),
        ("wornName", "Worn effect"),
        ("bardName", "Bard effect"),
    ] {
        if let Some(value) = row
            .get::<_, Option<String>>(column)?
            .filter(|value| !value.is_empty())
        {
            lines.push(format!("{label}: {value}"));
        }
    }
    let weight = number(row, "weight")?;
    let weight = format!("{:.1}", weight as f64 / 10.0);
    lines.push(format!(
        "WT: {}",
        weight.trim_end_matches('0').trim_end_matches('.')
    ));
    lines.push(format!("Size: {}", size(number(row, "size")?)?));
    for (column, label, names, later) in [
        ("classes", "Class", CLASSES, 1 << 14),
        ("races", "Race", RACES, 1 << 13),
    ] {
        let mask = number(row, column)?;
        if mask != 0 {
            lines.push(format!(
                "{label}: {}",
                mask_names(mask, names, true, later)?
            ));
        }
    }
    if number(row, "deity")? != 0 {
        lines.push(format!(
            "Deity: {}",
            mask_names(number(row, "deity")?, DEITIES, false, 0)?
        ));
    }
    if number(row, "bagSlots")? != 0 {
        lines.push(format!("Capacity: {}", number(row, "bagSlots")?));
        lines.push(format!(
            "Container size: {}",
            size(number(row, "bagSize")?)?
        ));
        lines.push(format!("Weight reduction: {}%", number(row, "bagWr")?));
    }
    let name = row.get::<_, String>("name")?.trim().to_owned();
    ensure!(
        !name.is_empty()
            && name.len() <= 256
            && lines.len() <= 64
            && lines.iter().map(String::len).sum::<usize>() <= 8192,
        "Invalid item card bounds"
    );
    ensure!(
        std::iter::once(&name).chain(&lines).all(|text| !text
            .chars()
            .any(|c| c.is_control() || matches!(c, '<' | '>'))),
        "Invalid item text"
    );
    Ok(ItemDetails { name, lines })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn masks_reject_unknown_bits_and_preserve_classic_rules() {
        assert!(mask_names(-1, CLASSES, true, 1 << 14).is_err());
        assert!(mask_names(1 << 20, CLASSES, true, 1 << 14).is_err());
        assert_eq!(mask_names(32767, CLASSES, true, 1 << 14).unwrap(), "ALL");
        assert_eq!(
            mask_names((1 << 1) | (1 << 4), SLOTS, false, 0).unwrap(),
            "EAR"
        );
        assert!(size(-1).is_err());
        assert!(size(5).is_err());
    }
}
