/// The tiles one traversal may subdivide past their screen-space error to
/// reach a source's min zoom. Each level of that descent quadruples the
/// tiles under the view, so a min zoom far above the level the view needs
/// would otherwise grow the quadtree until memory runs out.
pub struct MinZoomDescentBudget {
    limit: usize,
    spent: usize,
}

impl Default for MinZoomDescentBudget {
    fn default() -> Self {
        Self::with_limit(Self::DEFAULT_LIMIT)
    }
}

impl MinZoomDescentBudget {
    /// A larger budget lets the tiles under the view take gigabytes of memory.
    pub const DEFAULT_LIMIT: usize = 1 << 10;

    pub fn with_limit(limit: usize) -> Self {
        Self { limit, spent: 0 }
    }

    /// Gives the next traversal the whole budget.
    pub fn refill(&mut self) {
        self.spent = 0;
    }

    /// Takes one tile's subdivision out of the budget. Returns `false` once
    /// the budget is spent: the tile then stays undivided.
    pub fn try_spend(&mut self) -> bool {
        if self.is_spent() {
            return false;
        }
        self.spent += 1;
        true
    }

    pub fn is_spent(&self) -> bool {
        self.spent >= self.limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn try_spend_admits_up_to_the_limit_until_refilled() {
        let mut budget = MinZoomDescentBudget::with_limit(2);
        assert!(budget.try_spend());
        assert!(budget.try_spend());
        assert!(budget.is_spent());
        assert!(!budget.try_spend());

        budget.refill();
        assert!(!budget.is_spent());
        assert!(budget.try_spend());
    }
}
