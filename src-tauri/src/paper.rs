//! A printer driver's default paper in mm, from its default DEVMODE (ADR 0004: a Tape Size takes
//! the tape from the driver's Printing preferences, so the app checks it before printing).
//!
//! Pure std (no Tauri or Windows), so the tests also run where Tauri cannot link:
//! `rustc --edition 2021 --test src/paper.rs -o <scratch>/paper-tests && <scratch>/paper-tests`.

// Only the Windows build reads a DEVMODE.
#![cfg_attr(not(windows), allow(dead_code))]

/// `DEVMODEW.dmFields` bits.
pub const DM_PAPERSIZE: u32 = 0x2;
pub const DM_PAPERLENGTH: u32 = 0x4;
pub const DM_PAPERWIDTH: u32 = 0x8;

/// The paper fields of a DEVMODE: `dmFields` and the paper id, length and width (tenths of a mm).
pub struct DevmodePaper {
    pub fields: u32,
    pub paper_size: i16,
    pub paper_length: i16,
    pub paper_width: i16,
}

/// The driver's paper width and length (None if it reports none) in mm, or None if it reports no
/// width: `dmPaperWidth`/`dmPaperLength` when set, else the size of the paper `dmPaperSize` names in
/// the driver's paper list (`papers` from `DC_PAPERS`, `sizes` from `DC_PAPERSIZE`, tenths of a mm,
/// width × length).
pub fn paper_mm(
    devmode: &DevmodePaper,
    papers: &[u16],
    sizes: &[(i32, i32)],
) -> Option<(f64, Option<f64>)> {
    let set = |flag: u32| devmode.fields & flag != 0;
    if set(DM_PAPERWIDTH) && devmode.paper_width > 0 {
        let length = (set(DM_PAPERLENGTH) && devmode.paper_length > 0)
            .then(|| tenths(i32::from(devmode.paper_length)));
        return Some((tenths(i32::from(devmode.paper_width)), length));
    }
    if !set(DM_PAPERSIZE) || devmode.paper_size <= 0 {
        return None;
    }
    let index = papers
        .iter()
        .position(|&paper| i32::from(paper) == i32::from(devmode.paper_size))?;
    let &(width, length) = sizes.get(index)?;
    (width > 0).then(|| (tenths(width), (length > 0).then(|| tenths(length))))
}

fn tenths(value: i32) -> f64 {
    f64::from(value) / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn devmode(fields: u32, paper_size: i16, paper_length: i16, paper_width: i16) -> DevmodePaper {
        DevmodePaper {
            fields,
            paper_size,
            paper_length,
            paper_width,
        }
    }

    #[test]
    fn takes_the_custom_width_and_length_in_tenths_of_a_mm() {
        let custom = devmode(DM_PAPERWIDTH | DM_PAPERLENGTH | DM_PAPERSIZE, 256, 400, 239);
        assert_eq!(
            paper_mm(&custom, &[256], &[(360, 1000)]),
            Some((23.9, Some(40.0)))
        );
    }

    #[test]
    fn a_custom_width_without_a_length_has_no_length() {
        assert_eq!(
            paper_mm(&devmode(DM_PAPERWIDTH, 0, 400, 240), &[], &[]),
            Some((24.0, None))
        );
        assert_eq!(
            paper_mm(
                &devmode(DM_PAPERWIDTH | DM_PAPERLENGTH, 0, 0, 240),
                &[],
                &[]
            ),
            Some((24.0, None))
        );
    }

    #[test]
    fn otherwise_looks_up_the_named_paper_in_the_drivers_list() {
        let named = devmode(DM_PAPERSIZE, 260, 0, 0);
        let papers = [9, 259, 260];
        let sizes = [(2100, 2970), (240, 0), (360, 1000)];
        assert_eq!(paper_mm(&named, &papers, &sizes), Some((36.0, Some(100.0))));
        assert_eq!(
            paper_mm(&devmode(DM_PAPERSIZE, 259, 0, 0), &papers, &sizes),
            Some((24.0, None))
        );
    }

    #[test]
    fn reports_nothing_when_the_driver_gives_no_usable_width() {
        assert_eq!(
            paper_mm(&devmode(0, 260, 0, 0), &[260], &[(360, 1000)]),
            None
        );
        assert_eq!(
            paper_mm(&devmode(DM_PAPERSIZE, 261, 0, 0), &[260], &[(360, 1000)]),
            None
        );
        assert_eq!(
            paper_mm(&devmode(DM_PAPERSIZE, 260, 0, 0), &[260], &[]),
            None
        );
        assert_eq!(
            paper_mm(&devmode(DM_PAPERSIZE, 260, 0, 0), &[260], &[(0, 1000)]),
            None
        );
        assert_eq!(paper_mm(&devmode(DM_PAPERWIDTH, 0, 0, 0), &[], &[]), None);
    }
}
