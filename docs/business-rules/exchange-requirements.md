# Exchange Integration Business Rules

## Core Requirements

All exchange plugins must adhere to these fundamental business rules to ensure consistent behavior across the Edge ecosystem.

## Supported Exchange Types

### Centralized Exchanges (CEX)

- **Definition**: Exchanges that maintain custody of user funds during swaps
- **Requirements**:
  - API key management through `initOptions`
  - Order tracking via external URLs
  - Partner revenue reporting integration
  - Support for exchange-specific memo/tag requirements

### Decentralized Exchanges (DEX)

- **Definition**: Non-custodial exchanges operating via smart contracts
- **Requirements**:
  - Direct wallet-to-wallet transactions
  - Gas fee estimation and reporting
  - Slippage tolerance handling
  - No API key requirements

## Mandatory Business Rules

### 1. Amount Precision

- **Always use string representation** for all amounts
- Native units only (satoshis, wei, etc.)
- No floating-point arithmetic
- Example: `"1000000000000000000"` for 1 ETH

### 2. Currency Support Validation

- Must validate both source and destination currencies
- Throw `SwapCurrencyError` for unsupported pairs
- Support both native assets and tokens
- Handle mainnet-only restrictions appropriately

### 3. Limit Enforcement

- **Minimum amount checking**: Throw `SwapBelowLimitError`
- **Maximum amount checking**: Throw `SwapAboveLimitError`
- Limits must be checked before quote generation
- Include actual limits in error messages

### 4. Quote Expiration

- Quotes should include expiration handling
- DEX quotes: Typically 15-30 minutes
- CEX quotes: Follow exchange-specific expiration
- Must handle expired quotes gracefully

### 5. Network Fee Reporting

- CEX: Report exchange fees if applicable
- DEX: Must calculate and report gas fees
- Include fee currency code with amount
- Parent network fees for token swaps

## Revenue and Reporting

### Partner Integration

For centralized exchanges:

- Must submit accompanying PR to `edge-reports` repository
- Implement transaction tracking credited to Edge users
- Provide partner API documentation
- Include revenue share agreement details

### Fee Structure

- Exchange fees must be transparent
- Edge fee (if applicable) handled separately
- No hidden fees or markups beyond stated rates

## Security Requirements

### API Key Management

- Keys stored in `initOptions` only
- Never log or expose API credentials
- Support for both public and private key pairs
- Implement proper key rotation support

### Address Validation

- Validate all destination addresses
- Check address format for target blockchain
- Handle memo/tag requirements for applicable chains
- Prevent sending to contract addresses when inappropriate

### Transaction Safety

- Double-check amounts before submission
- Implement confirmation step in `approve()` method
- No automatic retries for failed transactions
- Clear error messages for user action

## User Experience Rules

### Display Information

Required info for `EdgeSwapInfo`:

- `pluginId`: Unique identifier
- `displayName`: User-friendly name
- `isDex`: Boolean flag for DEX/CEX
- `supportEmail`: Contact for issues

### Quote Response Time

- Target: Under 5 seconds for quote generation
- Timeout: Maximum 30 seconds
- Provide loading feedback capability
- Cache exchange rates when appropriate

### Error Messaging

- User-friendly error descriptions
- Include actionable information
- Differentiate temporary vs permanent failures
- Provide support contact for exchange-specific issues

## Compliance and Legal

### Jurisdictional Restrictions

- Respect exchange geographic limitations
- Implement IP-based restrictions if required
- Clear messaging for restricted regions
- OFAC and sanctions compliance

### KYC/AML Requirements

- Disclose any KYC requirements upfront
- Handle KYC-gated features appropriately
- Support for tiered limits based on verification
- Privacy-preserving where possible

## Testing Requirements

### Minimum Test Coverage

- Basic quote fetching
- Amount limit validation
- Currency pair support
- Error handling scenarios
- Network failure resilience

### Integration Testing

- Test against real exchange APIs
- Verify with multiple currency pairs
- Confirm proper fee calculation
- Validate address generation

## Maintenance and Support

### Version Compatibility

- Maintain compatibility with edge-core-js v0.19.37+
- Document breaking changes
- Support graceful degradation
- Version-specific feature flags

### Monitoring and Alerts

- Log exchange API errors
- Track quote success rates
- Monitor for rate limiting
- Report degraded service appropriately

## Special Considerations

### Cross-chain Swaps

- Clear indication of bridge risks
- Accurate time estimates
- Handle failed bridge transactions
- Support for refund scenarios

### Stablecoin Handling

- Recognize stablecoin pairs
- Appropriate decimal precision
- Handle de-pegging scenarios
- Support for multiple stablecoin standards

### Network Congestion

- Dynamic gas price adjustment
- Congestion warnings to users
- Alternative route suggestions
- Transaction acceleration options

## Prohibited Practices

### Never:

- Store user private keys
- Modify exchange rates without disclosure
- Bypass exchange limits programmatically
- Cache sensitive user data
- Automatically retry failed swaps
- Hide or obfuscate fees
- Make unauthorized partner API calls

### Always:

- Validate all external inputs
- Use secure communication (HTTPS)
- Handle rate limiting gracefully
- Provide transaction receipts
- Support transaction tracking
- Maintain audit logs
- Update exchange info regularly

## Performance Standards

### Response Times

- Quote generation: < 5 seconds typical
- Order creation: < 10 seconds typical
- Status checks: < 2 seconds typical

### Reliability Targets

- 99% uptime for quote generation
- Graceful degradation during outages
- Automatic failover for multi-endpoint exchanges
- Circuit breaker pattern for repeated failures

## Documentation Requirements

### Required Documentation

- API integration details
- Supported currency pairs
- Known limitations
- Troubleshooting guide
- Configuration examples

### Logo and Branding

- 64x64px square logo (white background)
- 600x210px horizontal logo (no padding)
- Proper trademark attribution
- Brand guidelines compliance
