import { privateKeyToAccount } from '../../accounts/privateKeyToAccount.js'
import { sign } from '../../accounts/utils/sign.js'
import {
  type Chain,
  type PrivateKeyAccount,
  type Transport,
  type WalletClient,
  createWalletClient,
  keccak256,
} from '../../index.js'
import { type Hex } from '../../types/misc.js'
import { suaveRigil } from '../index.js'
import {
  serializeConfidentialComputeRecord,
  serializeConfidentialComputeRequest,
} from './serializers.js'
import {
  SuaveTxTypes,
  type TransactionRequestSuave,
  type TransactionSerializableSuave,
} from './types.js'

async function signConfidentialComputeRecord(
  transaction: TransactionSerializableSuave,
  privateKey: Hex,
): Promise<TransactionSerializableSuave> {
  if (transaction.type !== SuaveTxTypes.ConfidentialRecord) {
    throw new Error(
      `transaction.type must be ConfidentialRecord (${SuaveTxTypes.ConfidentialRecord})`,
    )
  }
  const serialized = serializeConfidentialComputeRecord(transaction)
  const { r, s, v } = await sign({ hash: keccak256(serialized), privateKey })
  const signature = {
    r,
    s,
    v: v === 27n ? 0n : 1n,
  }
  return {
    ...transaction,
    ...signature,
  }
}

export function getSuaveWallet<
  TTransport extends Transport,
  TChain extends Chain,
>(
  params: { transport: TTransport; chain: TChain },
  privateKey: Hex,
): WalletClient<
  TTransport,
  TChain,
  PrivateKeyAccount // TODO: generalize account types (required to make metamask transport work)
> {
  return createWalletClient({
    account: privateKey ? privateKeyToAccount(privateKey) : undefined,
    transport: params.transport,
    chain: params.chain,
  }).extend((client) => ({
    async sendTransaction(txRequest: TransactionRequestSuave) {
      const preparedTx = await client.prepareTransactionRequest(
        txRequest as any,
      )
      const payload: TransactionRequestSuave = {
        ...txRequest,
        from: preparedTx.from,
        nonce: preparedTx.nonce,
        gas: txRequest.gas ?? preparedTx.gas,
        gasPrice: txRequest.gasPrice ?? preparedTx.gasPrice,
        chainId: txRequest.chainId ?? suaveRigil.id,
      }

      const signedTx = await this.signTransaction(payload)
      return client.request({
        method: 'eth_sendRawTransaction',
        params: [signedTx],
      })
    },
    async signTransaction(txRequest: TransactionRequestSuave) {
      if (txRequest.type === SuaveTxTypes.ConfidentialRequest) {
        const confidentialInputs = txRequest.confidentialInputs || '0x'
        const presignTx = {
          ...txRequest,
          type: SuaveTxTypes.ConfidentialRecord,
          confidentialInputsHash: keccak256(confidentialInputs),
          chainId: txRequest.chainId ?? suaveRigil.id,
        }
        const { r, s, v } = await signConfidentialComputeRecord(
          presignTx,
          privateKey,
        )
        return serializeConfidentialComputeRequest({
          ...presignTx,
          confidentialInputs,
          type: SuaveTxTypes.ConfidentialRequest,
          r,
          s,
          v,
        })
      } else {
        return await client.account.signTransaction(txRequest as any)
      }
    },
  }))
}